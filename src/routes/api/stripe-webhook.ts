// src/routes/api/stripe-webhook.ts
import { createFileRoute } from '@tanstack/react-router'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { notifyAdminBookingConfirmed } from '../../lib/booking-email'
import { notifyGuestBookingConfirmed } from '../../lib/welcome-email'

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

                const stripe = new Stripe(stripeSecret, {
                    // Pin the API version your account is set to use to avoid breaking changes
                    apiVersion: '2023-10-16' as Stripe.StripeConfig['apiVersion'],
                })

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
                            const { data: rows, error } = await supabaseAdmin
                                .from('bookings')
                                .update({ status: 'confirmed' })
                                .eq('stripe_payment_intent_id', pi.id)
                                .select('id')
                            if (error) {
                                console.error('Supabase update error (confirm):', error)
                                throw error
                            }
                            if (!rows || rows.length === 0) {
                                console.warn('No booking matched for PaymentIntent (will retry):', pi.id)
                                // Return 500 so Stripe retries; this handles race where event arrives before insert commit
                                return new Response('Booking not yet available', { status: 500 })
                            }
                            console.log(`Booking confirmed for PaymentIntent: ${pi.id}`)
                            // Called from both this case and charge.succeeded
                            // below, because either can arrive first. The claim
                            // inside it makes the duplicate call a no-op, and it
                            // never throws, so a Gmail outage can't push this
                            // handler into the 500 path and start retries.
                            await notifyAdminBookingConfirmed(supabaseAdmin, rows[0]!.id)
                            // The guest's own copy, claimed separately on
                            // guest_notified_at so the two can't starve each
                            // other: if one has already been sent and the other
                            // hasn't, a retry still delivers the missing one.
                            await notifyGuestBookingConfirmed(supabaseAdmin, rows[0]!.id)
                            break
                        }
                        case 'payment_intent.payment_failed': {
                            const pi = event.data.object as Stripe.PaymentIntent
                            // Best-effort mark as failed if schema supports it; ignore if update policy denies
                            const { error } = await supabaseAdmin
                                .from('bookings')
                                .update({ status: 'failed' })
                                .eq('stripe_payment_intent_id', pi.id)
                            if (error) console.warn('Failed to mark booking as failed:', error.message)
                            break
                        }
                        case 'payment_intent.canceled': {
                            const pi = event.data.object as Stripe.PaymentIntent
                            const { error } = await supabaseAdmin
                                .from('bookings')
                                .update({ status: 'canceled' })
                                .eq('stripe_payment_intent_id', pi.id)
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
                            const { error } = await supabaseAdmin
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
                                    const { error } = await supabaseAdmin
                                        .from('bookings')
                                        .update({ refunded_amount: null })
                                        .eq('stripe_payment_intent_id', piId)
                                    if (error) console.warn('Failed to clear refunded_amount:', error.message)
                                }
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
                            const { data: rows, error } = await supabaseAdmin
                                .from('bookings')
                                .update({ status: 'confirmed' })
                                .eq('stripe_payment_intent_id', piId)
                                .select('id')
                            if (error) {
                                console.error('Supabase update error (confirm via charge):', error)
                                throw error
                            }
                            if (!rows || rows.length === 0) {
                                console.warn('No booking matched for charge.succeeded (will retry):', piId)
                                return new Response('Booking not yet available (charge)', { status: 500 })
                            }
                            console.log(`Booking confirmed via charge for PaymentIntent: ${piId}`)
                            await notifyAdminBookingConfirmed(supabaseAdmin, rows[0]!.id)
                            await notifyGuestBookingConfirmed(supabaseAdmin, rows[0]!.id)
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