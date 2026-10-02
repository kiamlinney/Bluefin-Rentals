// src/routes/api/stripe-webhook.ts
//
// The source of truth for money arriving. Two kinds of PaymentIntent come
// through here, and every event is routed by which one it's about:
//
//   - the checkout charge — bookings.stripe_payment_intent_id, metadata.kind
//     'trip' (or no kind, for intents created before the ledger existed);
//   - a ledger charge — a row in booking_charges (extension, extra, deposit,
//     owner's charge), metadata.kind naming it and metadata.chargeId pointing at
//     its row. These are handed to syncChargeFromIntent in
//     src/lib/payments.server.ts, which is the only place a ledger row moves.
//
// Before the ledger, every event was assumed to be a checkout: a second
// PaymentIntent on a booking matched no row, returned 500, and Stripe would have
// retried it for three days.
//
// Events this handles must all be subscribed on the Stripe webhook destination.
// Subscribing to fewer doesn't error — it silently disables that path. The list
// is in ImportantFiles/payments-overview.md and CLAUDE.md.

import { createFileRoute } from '@tanstack/react-router'
import Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
    onBookingConfirmed,
    recordBookingPaymentMethod,
    syncChargeFromIntent,
} from '../../lib/payments.server'
import { sendAdminAlert } from '../../lib/charge-email'

type AdminClient = SupabaseClient<any, any, any>

function isLedgerIntent(intent: Stripe.PaymentIntent): boolean {
    const kind = intent.metadata?.kind
    return Boolean(intent.metadata?.chargeId) || (Boolean(kind) && kind !== 'trip')
}

// A charge event carries only its PaymentIntent's id. The ledger row is found by
// that id; a checkout charge is anything that isn't one.
async function ledgerChargeFor(admin: AdminClient, paymentIntentId: string) {
    const { data } = await admin
        .from('booking_charges')
        .select('id')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .maybeSingle()
    return data
}

/**
 * Confirms the checkout booking for a PaymentIntent that succeeded.
 *
 * Read first, then update, so "no row yet" (the insert hasn't committed — worth
 * a retry) is told apart from "the row has moved on" (canceled or completed —
 * never revive it). The old blind update couldn't tell them apart.
 */
async function confirmCheckout(admin: AdminClient, paymentIntentId: string): Promise<Response | null> {
    const { data: row, error } = await admin
        .from('bookings')
        .select('id, status')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .maybeSingle()
    if (error) throw error

    if (!row) {
        console.warn('No booking matched for PaymentIntent (will retry):', paymentIntentId)
        // 500 so Stripe retries: the insert may not have committed yet.
        return new Response('Booking not yet available', { status: 500 })
    }

    if (row.status === 'canceled' || row.status === 'completed') {
        // A refunded or finished trip is never talked back into confirmed.
        console.warn(`PaymentIntent ${paymentIntentId} succeeded for a ${row.status} booking ${row.id}; not reviving it.`)
        return null
    }

    // pending, expired (a late card payment on an abandoned checkout — a paid
    // trip is a real trip), failed (a retry after a decline) or already confirmed.
    if (row.status !== 'confirmed') {
        const { error: updateErr } = await admin
            .from('bookings')
            .update({ status: 'confirmed' })
            .eq('id', row.id)
            .eq('status', row.status)
        if (updateErr) throw updateErr
        console.log(`Booking confirmed for PaymentIntent: ${paymentIntentId}`)
    }

    // Everything that follows a confirmation: the saved card, the deposit hold,
    // both emails. Called on every delivery; each step claims itself.
    await onBookingConfirmed(admin, row.id)
    return null
}

export const Route = createFileRoute('/api/stripe-webhook')({
    server: {
        handlers: {
            // Stripe Webhook endpoint — must receive raw body (use request.text())
            POST: async ({ request }) => {
                // Validate required env vars early
                const stripeSecret = process.env.STRIPE_SECRET_KEY
                const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
                const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
                const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

                if (!stripeSecret || !webhookSecret) {
                    console.error('Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET')
                    return new Response('Server misconfigured', { status: 500 })
                }
                if (!supabaseUrl || !supabaseServiceRoleKey) {
                    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for webhook')
                    return new Response('Server misconfigured', { status: 500 })
                }

                // No apiVersion pin: the SDK's own version (2026-03-25.dahlia for
                // stripe v21) is the version the destination delivers events in.
                const stripe = new Stripe(stripeSecret)

                const signature = request.headers.get('stripe-signature')
                if (!signature) {
                    return new Response('Missing Stripe signature', { status: 400 })
                }

                // Read raw body text for signature verification (do NOT parse JSON before this)
                const body = await request.text()

                let event: Stripe.Event
                try {
                    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
                } catch (err: any) {
                    console.error('Stripe signature verification failed:', err?.message)
                    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
                }

                // Use a Supabase service role client for server-to-server updates (bypass RLS)
                const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
                    auth: { persistSession: false, autoRefreshToken: false },
                })

                try {
                    switch (event.type) {
                        case 'payment_intent.succeeded': {
                            const pi = event.data.object as Stripe.PaymentIntent
                            if (isLedgerIntent(pi)) {
                                await syncChargeFromIntent(supabaseAdmin, pi)
                                break
                            }
                            const retry = await confirmCheckout(supabaseAdmin, pi.id)
                            if (retry) return retry
                            break
                        }

                        // A ledger charge moving: a hold landing, a bank asking the
                        // guest to authenticate, a cancel or a failure. The sync
                        // decides what each means.
                        case 'payment_intent.amount_capturable_updated':
                        case 'payment_intent.requires_action': {
                            const pi = event.data.object as Stripe.PaymentIntent
                            if (isLedgerIntent(pi)) await syncChargeFromIntent(supabaseAdmin, pi)
                            break
                        }

                        case 'payment_intent.payment_failed': {
                            const pi = event.data.object as Stripe.PaymentIntent
                            if (isLedgerIntent(pi)) {
                                await syncChargeFromIntent(supabaseAdmin, pi)
                                break
                            }
                            // Deliberately NOT marking the booking failed. Stripe
                            // sends this for every declined attempt, and the guest
                            // can retry with another card on the same intent — the
                            // old handler flipped the booking to `failed` on the
                            // first decline, so a successful retry then couldn't
                            // confirm it. The row stays pending; its hold lapses on
                            // the normal schedule if they give up.
                            console.log(`Checkout payment attempt declined for ${pi.id}: ${pi.last_payment_error?.message ?? 'unknown'}`)
                            break
                        }

                        case 'payment_intent.canceled': {
                            const pi = event.data.object as Stripe.PaymentIntent
                            if (isLedgerIntent(pi)) {
                                await syncChargeFromIntent(supabaseAdmin, pi)
                                break
                            }
                            // Only a still-pending checkout. cancelBooking marks its
                            // row `expired` before cancelling the intent, and
                            // intentForBooking repoints the row before cancelling
                            // the one it replaced — neither should be overwritten.
                            const { error } = await supabaseAdmin
                                .from('bookings')
                                .update({ status: 'canceled' })
                                .eq('stripe_payment_intent_id', pi.id)
                                .eq('status', 'pending')
                            if (error) console.warn('Failed to mark booking as canceled:', error.message)
                            break
                        }

                        // A refund is not final when refunds.create returns. It can
                        // reverse afterwards — a closed card, a bank rejection — and
                        // until now nothing told the database that, so a booking
                        // could show a refund that never actually landed.
                        //
                        // Reconciled from the charge rather than trusted from our own
                        // write: charge.amount_refunded is Stripe's running total in
                        // cents across every refund on that charge, so it stays right
                        // even for a refund issued from the dashboard by hand.
                        case 'charge.refunded': {
                            const charge = event.data.object as Stripe.Charge
                            const piId = (charge.payment_intent as string) || undefined
                            if (!piId) {
                                console.warn('charge.refunded missing payment_intent id')
                                break
                            }
                            const ledger = await ledgerChargeFor(supabaseAdmin, piId)
                            const { error } = ledger
                                ? await supabaseAdmin
                                    .from('booking_charges')
                                    .update({ amount_refunded: charge.amount_refunded / 100 })
                                    .eq('id', ledger.id)
                                : await supabaseAdmin
                                    .from('bookings')
                                    .update({ refunded_amount: charge.amount_refunded / 100 })
                                    .eq('stripe_payment_intent_id', piId)
                            if (error) console.warn('Failed to record refund amount:', error.message)
                            else console.log(`Refund recorded for PaymentIntent ${piId}: ${charge.amount_refunded / 100}`)
                            break
                        }
                        // The reversal case. Stripe sends this when a refund that had
                        // been accepted later fails, which means the money came back
                        // to us and the guest never got it. Deliberately loud: the
                        // booking stays canceled — the trip really is off — but
                        // somebody has to settle up with the guest by hand, and
                        // nothing else in the system will notice.
                        case 'refund.failed':
                        case 'charge.refund.updated': {
                            const refund = event.data.object as Stripe.Refund
                            if (refund.status === 'failed' || refund.status === 'canceled') {
                                const piId = (refund.payment_intent as string) || undefined
                                console.error(
                                    `[refund] REFUND ${refund.status.toUpperCase()} for PaymentIntent ${piId} ` +
                                    `(refund ${refund.id}, ${(refund.amount ?? 0) / 100}, reason: ${refund.failure_reason ?? 'unknown'}). ` +
                                    `The guest has NOT been paid — settle this manually.`,
                                )
                                if (piId) {
                                    const ledger = await ledgerChargeFor(supabaseAdmin, piId)
                                    if (ledger) {
                                        // Re-read Stripe's running total rather than
                                        // guessing which refund on the charge failed.
                                        const intent = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] })
                                        const latest = intent.latest_charge as Stripe.Charge | null
                                        await supabaseAdmin
                                            .from('booking_charges')
                                            .update({ amount_refunded: (latest?.amount_refunded ?? 0) / 100 })
                                            .eq('id', ledger.id)
                                    } else {
                                        const { error } = await supabaseAdmin
                                            .from('bookings')
                                            .update({ refunded_amount: null })
                                            .eq('stripe_payment_intent_id', piId)
                                        if (error) console.warn('Failed to clear refunded_amount:', error.message)
                                    }
                                }
                                await sendAdminAlert(supabaseAdmin, {
                                    subject: 'A refund failed — the guest has not been paid',
                                    lines: [
                                        `Refund ${refund.id} of $${((refund.amount ?? 0) / 100).toFixed(2)} ${refund.status} (${refund.failure_reason ?? 'no reason given'}).`,
                                        'Settle this with the guest by hand.',
                                    ],
                                })
                            }
                            break
                        }
                        case 'charge.succeeded': {
                            // Some flows deliver charge.succeeded slightly before/after PI events.
                            // Use it as a backup to confirm the booking.
                            const charge = event.data.object as Stripe.Charge
                            const piId = (charge.payment_intent as string) || undefined
                            if (!piId) {
                                console.warn('charge.succeeded missing payment_intent id')
                                break
                            }
                            const intent = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] })
                            if (isLedgerIntent(intent) || (await ledgerChargeFor(supabaseAdmin, piId))) {
                                await syncChargeFromIntent(supabaseAdmin, intent)
                                break
                            }
                            // An uncaptured authorization also sends charge.succeeded.
                            // Checkout intents capture automatically, so a
                            // requires_capture one here is not a paid booking.
                            if (intent.status !== 'succeeded') break
                            const retry = await confirmCheckout(supabaseAdmin, piId)
                            if (retry) return retry
                            break
                        }

                        // A card saved from the trip page. The page records it
                        // itself; this is the backup for a guest who closed the tab
                        // the moment the card was accepted.
                        case 'setup_intent.succeeded': {
                            const si = event.data.object as Stripe.SetupIntent
                            const bookingId = si.metadata?.bookingId
                            if (si.metadata?.kind !== 'card-update' || !bookingId) break
                            const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id
                            const customer = typeof si.customer === 'string' ? si.customer : si.customer?.id ?? null
                            if (pm) await recordBookingPaymentMethod(supabaseAdmin, bookingId, pm, customer)
                            break
                        }

                        // A chargeback. Nothing here can respond to it — evidence is
                        // submitted in the Stripe dashboard, against a deadline — so
                        // the job is to make sure a person knows today.
                        case 'charge.dispute.created': {
                            const dispute = event.data.object as Stripe.Dispute
                            const piId = typeof dispute.payment_intent === 'string'
                                ? dispute.payment_intent
                                : dispute.payment_intent?.id
                            let bookingId: string | undefined
                            if (piId) {
                                const ledger = await supabaseAdmin
                                    .from('booking_charges').select('booking_id').eq('stripe_payment_intent_id', piId).maybeSingle()
                                const checkout = await supabaseAdmin
                                    .from('bookings').select('id').eq('stripe_payment_intent_id', piId).maybeSingle()
                                bookingId = ledger.data?.booking_id ?? checkout.data?.id
                            }
                            const due = dispute.evidence_details?.due_by
                                ? new Date(dispute.evidence_details.due_by * 1000).toUTCString()
                                : 'see the Stripe dashboard'
                            await sendAdminAlert(supabaseAdmin, {
                                subject: `Chargeback opened: $${(dispute.amount / 100).toFixed(2)} (${dispute.reason})`,
                                lines: [
                                    `A guest's bank has disputed a payment (dispute ${dispute.id}, reason "${dispute.reason}").`,
                                    `Evidence is due by ${due}. Respond in the Stripe dashboard under Payments → Disputes; the trip's receipts, photos and messages are the evidence.`,
                                ],
                                bookingId,
                            })
                            break
                        }

                        case 'identity.verification_session.verified': {
                            const sess = event.data.object as Stripe.Identity.VerificationSession
                            const userId = (sess.metadata && (sess.metadata as any).userId) as string | undefined
                            if (userId) {
                                const { error } = await supabaseAdmin
                                    .from('profiles')
                                    .update({
                                        identity_verified: true,
                                        identity_verified_at: new Date().toISOString(),
                                        stripe_identity_session_id: sess.id
                                    })
                                    .eq('id', userId)
                                if (error) {
                                    console.error('Supabase update error (identity verified):', error)
                                    throw error
                                }
                            } else {
                                console.warn('identity.verified missing metadata.userId; skipping profile update')
                            }
                            break
                        }
                        case 'identity.verification_session.requires_input': {
                            const sess = event.data.object as Stripe.Identity.VerificationSession
                            const userId = (sess.metadata && (sess.metadata as any).userId) as string | undefined
                            if (userId) {
                                // Optional: persist a status flag or last_error for UX. Here we just keep the session id.
                                const { error } = await supabaseAdmin
                                    .from('profiles')
                                    .update({ stripe_identity_session_id: sess.id })
                                    .eq('id', userId)
                                if (error) console.warn('Supabase update warning (identity requires_input):', error.message)
                            }
                            break
                        }
                        case 'identity.verification_session.canceled': {
                            const sess = event.data.object as Stripe.Identity.VerificationSession
                            const userId = (sess.metadata && (sess.metadata as any).userId) as string | undefined
                            if (userId) {
                                const { error } = await supabaseAdmin
                                    .from('profiles')
                                    .update({ stripe_identity_session_id: sess.id })
                                    .eq('id', userId)
                                if (error) console.warn('Supabase update warning (identity canceled):', error.message)
                            }
                            break
                        }
                        default: {
                            // Unhandled event types are acknowledged to avoid Stripe retries
                            console.log(`Unhandled event type: ${event.type}`)
                        }
                    }
                } catch (err: any) {
                    console.error('Webhook processing error:', err?.message || err)
                    // 2xx response prevents endless retries only for logical errors we can tolerate.
                    // For unexpected errors, respond 500 so Stripe can retry.
                    return new Response('Webhook handler error', { status: 500 })
                }

                // Respond with 200 to acknowledge receipt
                return new Response('OK', { status: 200 })
            },
        },
    },
})