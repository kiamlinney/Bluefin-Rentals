// Money after checkout: the saved card, the charge ledger, the deposit hold,
// trip extensions, post-booking extras, refunds, and the scheduled sweep.
//
// Server-only (.server.ts): plain exported functions using the Stripe secret
// key and the service-role client. The server functions that call these live in
// src/lib/payments.ts; the webhook (src/routes/api/stripe-webhook.ts) and the
// cron route (src/routes/api/cron/payments.ts) call them directly.
//
// Every rule implemented here is written out for review in
// ImportantFiles/ — payments-overview.md is the map.
//
// ── The ledger, in one paragraph ─────────────────────────────────────────────
// The checkout charge is bookings.stripe_payment_intent_id + the frozen
// bookings.price_quote, and nothing here touches it. Every later charge is one
// booking_charges row with its own PaymentIntent. The row is inserted BEFORE the
// intent exists and the intent carries metadata.chargeId, so however Stripe's
// events race the code that created them, syncChargeFromIntent finds the row.
// syncChargeFromIntent is the one place a row's status moves, and
// applyChargeEffects is the one place a status change has consequences — so the
// webhook, the sweep and the page that just charged a card all behave the same.

import Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { notifyAdminBookingConfirmed } from './booking-email'
import { notifyGuestBookingConfirmed } from './welcome-email'
import {
    CHARGE_SELECT,
    toChargeRow,
    type ChargeInitiator,
    type ChargeKind,
    type ChargeLineItem,
    type ChargeRow,
    type ChargeStatus,
} from './charges.ts'
import {
    DEPOSIT_AMOUNT,
    DEPOSIT_PLACE_BEFORE_HOURS,
    DEPOSIT_RELEASE_AFTER_HOURS,
    DEPOSIT_RENEW_BEFORE_HOURS,
    DEPOSIT_RETRY_AFTER_HOURS,
    EXTENDED_AUTHORIZATION_ENABLED,
    depositIsDue,
    depositPlaceAt,
    depositReleaseAt,
} from './deposit.ts'
import {
    calculateExtensionPrice,
    extensionMode,
    type ExtensionMode,
    type ExtensionQuote,
} from './extension.ts'
import { calculateTax, taxContextFromQuote, type TaxContext, type TaxLine } from './tax.ts'
import { storedQuote } from './receipt.ts'
import { buildOverrideMap, wallClockToUtcIso } from './pricing.ts'
import { BUSINESS_CLOSE_MINUTES, BUSINESS_OPEN_MINUTES, SLOT_MINUTES } from './availability.ts'
import { businessDateKey, businessWallClockTime, formatBusinessDateTime, formatDayRange } from './dates.ts'
import { DEFAULT_BOOKING_RATE, type BookingRate } from './booking-rate.ts'
import { laterChargeRefund, type LaterCharge, type RefundOutcome } from './cancellation-policy.ts'
import { assertCarIsAvailable, PENDING_HOLD_MS } from './availability.server'
import {
    sendAdminAlert,
    sendChargeReceiptEmail,
    sendChargeRefundedEmails,
    sendDepositCapturedEmail,
    sendDepositDeclinedEmails,
    sendDepositHeldEmail,
    sendDepositReleasedEmail,
    sendExtensionEmail,
    sendPayLinkEmail,
} from './charge-email'

export type AdminClient = SupabaseClient<any, any, any>

const MS_PER_HOUR = 60 * 60 * 1000

// ═══════════════════════════════════════════════════════════════════════════
// Clients
// ═══════════════════════════════════════════════════════════════════════════

let stripeClient: Stripe | null = null

/**
 * The Stripe client. No apiVersion pin: the SDK sends the version it was built
 * for (2026-03-25.dahlia for stripe v21), which is also the version the webhook
 * destination delivers events in.
 */
export function getStripe(): Stripe {
    if (!stripeClient) {
        const key = process.env.STRIPE_SECRET_KEY
        if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
        stripeClient = new Stripe(key)
    }
    return stripeClient
}

export function serviceRoleClient(): AdminClient {
    return createClient(
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
    )
}

const toCents = (dollars: number) => Math.round(dollars * 100)
const fromCents = (cents: number) => Math.round(cents) / 100
const roundMoney = (dollars: number) => Math.round(dollars * 100) / 100

// Card only, for every charge — decided 2026-09-25. Stripe adds `link` to a
// card-only intent on its own when Link is enabled, so a card saved through
// Link still works here. Bank debits stay out for the reason set out at
// PAYMENT_METHOD_TYPES in db.ts: they settle in days, far too slowly for a hold.
const CARD_ONLY = ['card']

function idOf(value: string | { id: string } | null | undefined): string | null {
    if (!value) return null
    return typeof value === 'string' ? value : value.id
}

// ═══════════════════════════════════════════════════════════════════════════
// The saved card
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The guest's Stripe Customer, created on first use.
 *
 * Self-healing across the sandbox → live switch: a stored id from the other
 * mode comes back `resource_missing`, and is replaced rather than failing
 * checkout. The same happens if someone deletes the customer in the dashboard.
 */
export async function getOrCreateCustomer(admin: AdminClient, userId: string): Promise<string> {
    const { data: profile, error } = await admin
        .from('profiles')
        .select('stripe_customer_id, full_name, email, phone')
        .eq('id', userId)
        .single()
    if (error || !profile) throw new Error('Profile not found')

    const stripe = getStripe()
    const stored = profile.stripe_customer_id as string | null

    if (stored) {
        try {
            const existing = await stripe.customers.retrieve(stored)
            if (!('deleted' in existing && existing.deleted)) return existing.id
        } catch (err: any) {
            if (err?.code !== 'resource_missing') throw err
        }
    }

    const customer = await stripe.customers.create({
        email: profile.email ?? undefined,
        name: profile.full_name ?? undefined,
        phone: profile.phone ?? undefined,
        metadata: { userId },
    })

    // Conditional on the value we read, so two checkouts racing each other end
    // up agreeing on one customer instead of the later write orphaning the
    // earlier one's saved card.
    let claim = admin.from('profiles').update({ stripe_customer_id: customer.id }).eq('id', userId)
    claim = stored ? claim.eq('stripe_customer_id', stored) : claim.is('stripe_customer_id', null)
    const { data: won } = await claim.select('stripe_customer_id').maybeSingle()

    if (won) return customer.id

    const { data: winner } = await admin.from('profiles').select('stripe_customer_id').eq('id', userId).single()
    await stripe.customers.del(customer.id).catch(() => undefined)
    if (!winner?.stripe_customer_id) throw new Error('Could not set up a payment profile')
    return winner.stripe_customer_id as string
}

/** Records the card this booking's later charges and hold go on. */
export async function recordBookingPaymentMethod(
    admin: AdminClient,
    bookingId: string,
    paymentMethodId: string,
    customerId: string | null,
): Promise<void> {
    const { error } = await admin.from('bookings').update({ payment_method_id: paymentMethodId }).eq('id', bookingId)
    if (error) throw new Error(error.message)

    if (customerId) {
        await getStripe().customers
            .update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } })
            .catch((err: any) => console.warn('[payments] could not set default card:', err?.message))
    }
}

/**
 * Everything that follows a booking's checkout payment clearing.
 *
 * There are four confirmation paths — the webhook's payment_intent.succeeded
 * and charge.succeeded, confirmBooking, and getTripForGuest's revival of a
 * booking whose webhook never came — and every one of them calls this, so none
 * can forget a step. A fifth must too. Every step is idempotent (claims in the
 * database), so calling it four times does each thing once.
 *
 * Order matters: the deposit hold goes first, because a trip starting within a
 * day should get its lockbox code in the welcome email, and the code is only
 * given out once a hold is on the card.
 *
 * Never throws: a paid booking is confirmed whatever happens here.
 */
export async function onBookingConfirmed(admin: AdminClient, bookingId: string): Promise<void> {
    try {
        const { data: booking } = await admin
            .from('bookings')
            .select('id, payment_method_id, stripe_payment_intent_id')
            .eq('id', bookingId)
            .maybeSingle()

        if (booking && !booking.payment_method_id && booking.stripe_payment_intent_id) {
            const intent = await getStripe().paymentIntents.retrieve(booking.stripe_payment_intent_id)
            const pm = idOf(intent.payment_method as any)
            const customer = idOf(intent.customer as any)
            // Only a card that was saved to a customer can be used again, and
            // only intents created with setup_future_usage save one. A booking
            // paid before card saving existed has neither, and stays that way.
            if (pm && customer && intent.setup_future_usage) {
                await recordBookingPaymentMethod(admin, bookingId, pm, customer)
            }
        }
    } catch (err: any) {
        console.error(`[payments] could not record the saved card for ${bookingId}:`, err?.message || err)
    }

    try {
        await ensureDepositHold(admin, bookingId, { initiatedBy: 'system' })
    } catch (err: any) {
        console.error(`[payments] deposit hold after confirmation failed for ${bookingId}:`, err?.message || err)
    }

    await notifyAdminBookingConfirmed(admin, bookingId)
    await notifyGuestBookingConfirmed(admin, bookingId)
}

// ═══════════════════════════════════════════════════════════════════════════
// The ledger
// ═══════════════════════════════════════════════════════════════════════════

export type NewCharge = {
    bookingId: string
    kind: ChargeKind
    category?: string | null
    description: string
    amount: number
    taxLines?: TaxLine[]
    taxAmount?: number
    lineItems?: ChargeLineItem[]
    initiatedBy: ChargeInitiator
    createdBy?: string | null
    renewsChargeId?: string | null
}

/** Throws the raw Postgres error (so callers can read `.code`, e.g. 23505). */
export async function insertCharge(admin: AdminClient, charge: NewCharge): Promise<ChargeRow> {
    const { data, error } = await admin
        .from('booking_charges')
        .insert({
            booking_id: charge.bookingId,
            kind: charge.kind,
            category: charge.category ?? null,
            description: charge.description.trim().slice(0, 500),
            amount: roundMoney(charge.amount),
            tax_amount: roundMoney(charge.taxAmount ?? 0),
            tax_lines: charge.taxLines ?? [],
            line_items: charge.lineItems ?? [],
            initiated_by: charge.initiatedBy,
            created_by: charge.createdBy ?? null,
            renews_charge_id: charge.renewsChargeId ?? null,
        })
        .select(CHARGE_SELECT)
        .single()
    if (error) throw error
    return toChargeRow(data)
}

export async function loadCharge(admin: AdminClient, chargeId: string): Promise<ChargeRow | null> {
    const { data } = await admin.from('booking_charges').select(CHARGE_SELECT).eq('id', chargeId).maybeSingle()
    return data ? toChargeRow(data) : null
}

export async function loadCharges(admin: AdminClient, bookingId: string): Promise<ChargeRow[]> {
    const { data, error } = await admin
        .from('booking_charges')
        .select(CHARGE_SELECT)
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []).map(toChargeRow)
}

function chargeStatusFromIntent(intent: Stripe.PaymentIntent, kind: ChargeKind): ChargeStatus {
    switch (intent.status) {
        case 'succeeded': return 'succeeded'
        case 'requires_capture': return 'authorized'
        case 'processing': return 'processing'
        case 'canceled': return 'canceled'
        // A declined hold is finished — the next attempt is a new row, which is
        // what lets the in-flight index allow a retry. A declined charge is not:
        // it waits for the guest to pay it through the pay link.
        case 'requires_payment_method': return kind === 'deposit' ? 'failed' : 'requires_payment'
        default: return 'requires_payment'
    }
}

// Events can arrive out of order, so a status only ever moves forward, and a
// settled one never moves at all.
const STATUS_RANK: Record<ChargeStatus, number> = {
    requires_payment: 0,
    processing: 1,
    authorized: 2,
    succeeded: 3,
    canceled: 3,
    failed: 3,
}
const SETTLED = new Set<ChargeStatus>(['succeeded', 'canceled', 'failed'])

/**
 * Brings a ledger row up to date with its PaymentIntent, then runs whatever
 * that change means (applyChargeEffects). The only place a row's status moves.
 *
 * Returns null for an intent that isn't a ledger charge (e.g. a checkout).
 */
export async function syncChargeFromIntent(
    admin: AdminClient,
    intent: Stripe.PaymentIntent,
    options: { failureMessage?: string | null } = {},
): Promise<ChargeRow | null> {
    const chargeId = intent.metadata?.chargeId
    const { data: found } = chargeId
        ? await admin.from('booking_charges').select(CHARGE_SELECT).eq('id', chargeId).maybeSingle()
        : await admin.from('booking_charges').select(CHARGE_SELECT).eq('stripe_payment_intent_id', intent.id).maybeSingle()
    if (!found) return null

    const row = toChargeRow(found)
    // A row whose intent was replaced (the pay page swaps in a card-only one)
    // ignores events from the old intent.
    if (row.stripe_payment_intent_id && row.stripe_payment_intent_id !== intent.id) return row

    const incoming = chargeStatusFromIntent(intent, row.kind)
    const next = SETTLED.has(row.status) || STATUS_RANK[incoming] < STATUS_RANK[row.status]
        ? row.status
        : incoming

    let captureBefore: string | null = row.capture_before
    const latest = intent.latest_charge
    let latestCharge: Stripe.Charge | null = latest && typeof latest === 'object' ? latest : null
    if (!latestCharge && typeof latest === 'string' && incoming === 'authorized') {
        latestCharge = await getStripe().charges.retrieve(latest).catch(() => null)
    }
    const deadline = latestCharge?.payment_method_details?.card?.capture_before
    if (deadline) captureBefore = new Date(deadline * 1000).toISOString()

    const failure = options.failureMessage ?? intent.last_payment_error?.message ?? null

    const update: Record<string, unknown> = {
        status: next,
        stripe_payment_intent_id: intent.id,
        amount_captured: fromCents(intent.amount_received ?? 0),
        capture_before: captureBefore,
    }
    const paymentMethod = idOf(intent.payment_method as any)
    if (paymentMethod) update.payment_method_id = paymentMethod
    if (next === 'requires_payment' || next === 'failed') update.failure_message = failure
    if (SETTLED.has(next) && !row.settled_at) update.settled_at = new Date().toISOString()

    // Claimed on the status we read, so two callers syncing the same event can't
    // both run the consequences below.
    const { data: written } = await admin
        .from('booking_charges')
        .update(update)
        .eq('id', row.id)
        .eq('status', row.status)
        .select(CHARGE_SELECT)
        .maybeSingle()

    if (!written) return loadCharge(admin, row.id)

    const updated = toChargeRow(written)
    // The first sync counts as a change even when the status reads the same.
    // A row is inserted as `requires_payment`, and a declined off-session
    // charge *stays* `requires_payment` — so comparing statuses alone never
    // ran the effects for it, and the guest never got the pay link (found in
    // the 2026-09-29 rehearsal). Every effect claims itself, so running them
    // twice if the webhook and the page both make the first sync is harmless.
    const firstSync = !row.stripe_payment_intent_id
    if (updated.status !== row.status || firstSync) {
        await applyChargeEffects(admin, updated, row.status)
    }
    return updated
}

/** What a status change means. Never throws. */
async function applyChargeEffects(admin: AdminClient, charge: ChargeRow, previous: ChargeStatus): Promise<void> {
    try {
        switch (charge.kind) {
            case 'deposit':
                await applyDepositEffects(admin, charge)
                break
            case 'extension':
                await applyExtensionEffects(admin, charge)
                break
            case 'extra':
                await applyExtraEffects(admin, charge)
                break
            case 'adjustment':
                break
        }

        if (charge.status === 'succeeded' && charge.kind !== 'deposit') {
            await sendChargeReceiptEmail(admin, charge.id)
        }
        // The guest wasn't there when their card was charged — an owner billed
        // them, or the system did — so the pay link is the only way they'll know.
        // A guest-initiated charge that needs them is handled on the page they're on.
        if (charge.status === 'requires_payment' && charge.initiated_by !== 'guest' && charge.kind !== 'deposit') {
            await sendPayLinkEmail(admin, charge.id)
        }
    } catch (err: any) {
        console.error(`[payments] effects of ${previous} -> ${charge.status} failed for charge ${charge.id}:`, err?.message || err)
    }
}

export type ChargeAttempt = {
    charge: ChargeRow
    clientSecret: string | null
    /** The bank wants the guest to authenticate (3D Secure). */
    needsAction: boolean
    error: string | null
}

/**
 * Charges (or holds) a booking's saved card for a ledger row.
 *
 * `offSession` is true when the guest isn't there — an owner's charge, the
 * sweep. Then a bank that wants authentication fails the attempt instead of
 * asking, and the pay link takes over. On-session, the page gets a client
 * secret to run the authentication itself.
 */
export async function chargeSavedCard(
    admin: AdminClient,
    charge: ChargeRow,
    options: {
        customerId: string
        paymentMethodId: string
        capture: 'automatic' | 'manual'
        offSession: boolean
        extendedAuthorization?: boolean
    },
): Promise<ChargeAttempt> {
    const stripe = getStripe()
    let intent: Stripe.PaymentIntent | null = null
    let error: string | null = null

    try {
        intent = await stripe.paymentIntents.create(
            {
                amount: toCents(charge.amount + charge.tax_amount),
                currency: 'usd',
                customer: options.customerId,
                payment_method: options.paymentMethodId,
                payment_method_types: CARD_ONLY,
                capture_method: options.capture,
                confirm: true,
                ...(options.offSession ? { off_session: true } : {}),
                ...(options.extendedAuthorization
                    ? { payment_method_options: { card: { request_extended_authorization: 'if_available' } } }
                    : {}),
                description: charge.description,
                metadata: { kind: charge.kind, bookingId: charge.booking_id, chargeId: charge.id },
                expand: ['latest_charge'],
            },
            // One key per ledger row: a retried request returns the same intent
            // instead of charging twice.
            { idempotencyKey: `charge_${charge.id}` },
        )
    } catch (err: any) {
        error = err?.message ?? 'The card could not be charged'
        const raw = err?.raw?.payment_intent ?? err?.payment_intent

        // Only a card error is the guest's to fix: a decline, or their bank
        // wanting them to authenticate. Anything else is Stripe refusing the
        // request itself — our configuration, not their card — and must not
        // reach the guest as "your bank declined it". On 2026-09-29 every
        // deposit hold failed with "This account is not eligible for the
        // requested card features" (extended authorization not enabled), and
        // guests were told their bank had declined. So: close the row, cancel
        // any intent it left behind, tell the owners, and give the guest a
        // neutral message.
        const isCardError = err?.type === 'StripeCardError' || err?.raw?.type === 'card_error'
        if (!isCardError) {
            if (raw?.id) await stripe.paymentIntents.cancel(raw.id).catch(() => undefined)
            const { data: closed } = await admin
                .from('booking_charges')
                .update({
                    status: 'failed',
                    failure_message: `Stripe refused the request (not a card decline): ${error}`,
                    ...(raw?.id ? { stripe_payment_intent_id: raw.id } : {}),
                    settled_at: new Date().toISOString(),
                })
                .eq('id', charge.id)
                .in('status', ['requires_payment', 'processing'])
                .select(CHARGE_SELECT)
                .maybeSingle()
            await sendAdminAlert(admin, {
                subject: `Stripe refused a ${charge.kind} request`,
                lines: [
                    `Stripe refused "${charge.description}" before it reached the guest's card, so this is a setup problem, not a decline. The guest was not told their card was declined.`,
                    `Stripe said: ${error}`,
                ],
                bookingId: charge.booking_id,
            })
            return {
                charge: closed ? toChargeRow(closed) : charge,
                clientSecret: null,
                needsAction: false,
                error: 'We couldn’t process this payment right now. Bluefin has been notified and will be in touch.',
            }
        }

        // A decline or an authentication requirement arrives as an error that
        // still carries the intent it happened to.
        if (raw?.id) {
            intent = await stripe.paymentIntents.retrieve(raw.id, { expand: ['latest_charge'] }).catch(() => null)
        }
        if (!intent) {
            // No intent at all — Stripe refused the request itself. Nothing was
            // charged; the row is closed so a retry starts fresh.
            await admin
                .from('booking_charges')
                .update({ status: 'failed', failure_message: error, settled_at: new Date().toISOString() })
                .eq('id', charge.id)
            const failed = await loadCharge(admin, charge.id)
            if (failed) await applyChargeEffects(admin, failed, charge.status)
            return { charge: failed ?? charge, clientSecret: null, needsAction: false, error }
        }
    }

    const synced = await syncChargeFromIntent(admin, intent, { failureMessage: error })
    return {
        charge: synced ?? charge,
        clientSecret: intent.client_secret,
        needsAction: intent.status === 'requires_action',
        error,
    }
}

/**
 * Re-reads a charge's intent from Stripe and syncs it. The page calls this after
 * the guest finishes authenticating or pays through the pay link, the same way
 * confirmBooking backs up the webhook for checkout.
 *
 * A card the guest paid with there — having been told it will be saved — becomes
 * the trip's card on file.
 */
export async function refreshCharge(admin: AdminClient, charge: ChargeRow): Promise<ChargeRow> {
    if (!charge.stripe_payment_intent_id) return charge
    const intent = await getStripe().paymentIntents.retrieve(charge.stripe_payment_intent_id, { expand: ['latest_charge'] })
    const synced = (await syncChargeFromIntent(admin, intent)) ?? charge

    const pm = idOf(intent.payment_method as any)
    const customer = idOf(intent.customer as any)
    if (synced.status === 'succeeded' || synced.status === 'authorized') {
        if (pm && customer && intent.setup_future_usage) {
            const { data: booking } = await admin.from('bookings').select('payment_method_id').eq('id', charge.booking_id).single()
            if (booking && booking.payment_method_id !== pm) {
                await recordBookingPaymentMethod(admin, charge.booking_id, pm, customer)
            }
        }
    }
    return synced
}

/**
 * The client secret the pay page mounts a Payment Element on, for a charge the
 * saved card couldn't pay.
 *
 * setup_future_usage is added so a new card the guest pays with here is saved —
 * the page says so above the card field. It can't be set on the original
 * attempt, which was confirmed with the old card.
 */
export async function preparePayLink(admin: AdminClient, charge: ChargeRow): Promise<{ clientSecret: string | null; paid: boolean }> {
    if (charge.status === 'succeeded') return { clientSecret: null, paid: true }
    if (charge.status !== 'requires_payment' || charge.kind === 'deposit') {
        throw new Error('This charge is not waiting for a payment.')
    }
    if (!charge.stripe_payment_intent_id) throw new Error('This charge has no payment to complete.')

    const stripe = getStripe()
    let intent = await stripe.paymentIntents.retrieve(charge.stripe_payment_intent_id)
    if (intent.status === 'succeeded') {
        await syncChargeFromIntent(admin, intent)
        return { clientSecret: null, paid: true }
    }
    if (intent.setup_future_usage !== 'off_session' && intent.status !== 'requires_action') {
        intent = await stripe.paymentIntents.update(intent.id, { setup_future_usage: 'off_session' })
    }
    return { clientSecret: intent.client_secret, paid: false }
}

/**
 * Refunds some or all of a charge. Owners only — the caller checks.
 *
 * The idempotency key includes how much had been refunded before, so a retried
 * request is the same refund, but a genuine second partial refund is not
 * mistaken for a retry of the first.
 */
export async function refundCharge(
    admin: AdminClient,
    charge: ChargeRow,
    amount: number,
    reason: string,
    // Emails the guest and the owners. Off for cancellations, whose own email
    // already states every refund, so the guest isn't told twice.
    options: { notify?: boolean } = {},
): Promise<ChargeRow> {
    const refundable = roundMoney(charge.amount_captured - charge.amount_refunded)
    if (charge.status !== 'succeeded' || refundable <= 0) throw new Error('Nothing on this charge can be refunded.')
    if (!(amount > 0) || amount > refundable + 0.001) {
        throw new Error(`Refund must be between $0.01 and $${refundable.toFixed(2)}.`)
    }
    if (!charge.stripe_payment_intent_id) throw new Error('This charge has no payment to refund.')

    const refund = await getStripe().refunds.create(
        {
            payment_intent: charge.stripe_payment_intent_id,
            amount: toCents(amount),
            metadata: { chargeId: charge.id, bookingId: charge.booking_id, reason: reason.slice(0, 450) },
        },
        { idempotencyKey: `refund_${charge.id}_${toCents(charge.amount_refunded)}_${toCents(amount)}` },
    )

    // A retried request gets the same refund back from Stripe (idempotency key).
    // It's already counted and already announced, so neither happens twice.
    if (charge.refund_id === refund.id) return charge

    // charge.refunded reconciles this from Stripe's own running total; writing it
    // here too means the page is right before the webhook lands.
    const { data } = await admin
        .from('booking_charges')
        .update({ amount_refunded: roundMoney(charge.amount_refunded + amount), refund_id: refund.id })
        .eq('id', charge.id)
        .select(CHARGE_SELECT)
        .single()
    const updated = data ? toChargeRow(data) : charge

    if (options.notify) await sendChargeRefundedEmails(admin, updated, amount, reason)
    return updated
}

/**
 * How every later charge on a trip is taxed: by the same jurisdiction and
 * short-term classification the trip itself was quoted under (tax.ts). A trip
 * extended past 28 days stays a short-term rental, because the classification
 * is the length booked.
 */
function taxContextFor(booking: { price_quote: unknown }): TaxContext {
    return taxContextFromQuote(storedQuote(booking as any))
}

/** The booking fields the saved-card paths need, with the guest's customer. */
async function loadBillingContext(admin: AdminClient, bookingId: string) {
    const { data: booking, error } = await admin
        .from('bookings')
        .select('id, car_id, user_id, status, start_time, end_time, booking_rate, payment_method_id, deposit_waived_at, price_quote, cars(price_per_day)')
        .eq('id', bookingId)
        .single()
    if (error || !booking) throw new Error('Booking not found')

    const { data: profile } = await admin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', booking.user_id)
        .single()

    return {
        booking: booking as any,
        customerId: (profile?.stripe_customer_id as string | null) ?? null,
        paymentMethodId: (booking.payment_method_id as string | null) ?? null,
    }
}

/**
 * An owner billing a guest's saved card for something that came up: damage,
 * mileage, tolls. Off-session: if the bank wants the guest, the pay link goes out.
 */
export async function createAdjustmentCharge(
    admin: AdminClient,
    input: { bookingId: string; category: string; description: string; amount: number; createdBy: string },
): Promise<ChargeAttempt> {
    if (!(input.amount > 0)) throw new Error('Enter an amount above $0.')
    const { booking, customerId, paymentMethodId } = await loadBillingContext(admin, input.bookingId)
    if (!customerId || !paymentMethodId) {
        throw new Error('This guest has no saved card on this trip. Send them a payment link instead.')
    }

    const tax = calculateTax([{ taxKey: input.category, amount: input.amount }], taxContextFor(booking))
    const charge = await insertCharge(admin, {
        bookingId: input.bookingId,
        kind: 'adjustment',
        category: input.category,
        description: input.description,
        amount: input.amount,
        taxLines: tax.lines,
        taxAmount: tax.total,
        lineItems: [{ label: input.description, amount: roundMoney(input.amount) }],
        initiatedBy: 'admin',
        createdBy: input.createdBy,
    })

    return chargeSavedCard(admin, charge, { customerId, paymentMethodId, capture: 'automatic', offSession: true })
}

// ═══════════════════════════════════════════════════════════════════════════
// The deposit hold
// ═══════════════════════════════════════════════════════════════════════════

export type DepositAttempt = {
    state:
        | 'not-confirmed'
        | 'not-due'
        | 'waived'
        | 'held'
        | 'in-flight'
        | 'no-card'
        | 'backoff'
        | 'placed'
        | 'needs-action'
        | 'declined'
    clientSecret?: string | null
    message?: string | null
    chargeId?: string
}

async function depositRows(admin: AdminClient, bookingId: string): Promise<ChargeRow[]> {
    const { data } = await admin
        .from('booking_charges')
        .select(CHARGE_SELECT)
        .eq('booking_id', bookingId)
        .eq('kind', 'deposit')
        .order('created_at', { ascending: false })
    return (data ?? []).map(toChargeRow)
}

/**
 * Places the trip's hold if it's owed one and doesn't have one. Safe to call
 * from anywhere, any number of times: after confirmation, from the sweep, from
 * the trip page after the guest updates their card.
 *
 * `force` skips the retry backoff and lets go of an unfinished attempt — used
 * when the guest has just added a card and is waiting on the page. It never
 * places a hold early: a hold placed days ahead would burn through its 7-day
 * life before the trip, so the not-yet-due check always applies.
 */
export async function ensureDepositHold(
    admin: AdminClient,
    bookingId: string,
    options: { now?: Date; onSession?: boolean; force?: boolean; initiatedBy?: ChargeInitiator } = {},
): Promise<DepositAttempt> {
    const now = options.now ?? new Date()
    const { booking, customerId, paymentMethodId } = await loadBillingContext(admin, bookingId)

    if (booking.status !== 'confirmed') return { state: 'not-confirmed' }
    if (booking.deposit_waived_at) return { state: 'waived' }

    const start = new Date(booking.start_time)
    const end = new Date(booking.end_time)
    if (!depositIsDue(start, end, now)) return { state: 'not-due' }

    const rows = await depositRows(admin, bookingId)
    if (rows.some(r => r.status === 'authorized' || r.status === 'succeeded')) return { state: 'held' }

    // An attempt stuck waiting on authentication the guest walked away from
    // would block every retry through the in-flight index. Let it go.
    for (const row of rows.filter(r => r.status === 'requires_payment' || r.status === 'processing')) {
        const stale = now.getTime() - new Date(row.created_at).getTime() > PENDING_HOLD_MS
        if (!stale && !options.force) return { state: 'in-flight', chargeId: row.id }
        await abandonCharge(admin, row, 'Authentication was not completed')
    }

    if (!customerId || !paymentMethodId) return { state: 'no-card' }

    const lastFailure = rows.find(r => r.status === 'failed')
    if (!options.force && lastFailure && rows[0]?.id === lastFailure.id) {
        const since = now.getTime() - new Date(lastFailure.created_at).getTime()
        if (since < DEPOSIT_RETRY_AFTER_HOURS * MS_PER_HOUR) return { state: 'backoff' }
    }

    return placeDepositHold(admin, bookingId, {
        customerId,
        paymentMethodId,
        onSession: Boolean(options.onSession),
        initiatedBy: options.initiatedBy ?? 'system',
        renewsChargeId: null,
    })
}

async function placeDepositHold(
    admin: AdminClient,
    bookingId: string,
    options: {
        customerId: string
        paymentMethodId: string
        onSession: boolean
        initiatedBy: ChargeInitiator
        renewsChargeId: string | null
    },
): Promise<DepositAttempt> {
    let charge: ChargeRow
    try {
        charge = await insertCharge(admin, {
            bookingId,
            kind: 'deposit',
            description: options.renewsChargeId ? 'Security deposit hold (renewed)' : 'Security deposit hold',
            amount: DEPOSIT_AMOUNT,
            initiatedBy: options.initiatedBy,
            renewsChargeId: options.renewsChargeId,
        })
    } catch (err: any) {
        // Someone else is placing it right now (the in-flight index).
        if (err?.code === '23505') return { state: 'in-flight' }
        throw err
    }

    const attempt = await chargeSavedCard(admin, charge, {
        customerId: options.customerId,
        paymentMethodId: options.paymentMethodId,
        capture: 'manual',
        offSession: !options.onSession,
        extendedAuthorization: EXTENDED_AUTHORIZATION_ENABLED,
    })

    if (attempt.charge.status === 'authorized') return { state: 'placed', chargeId: charge.id }
    if (attempt.needsAction) {
        return { state: 'needs-action', clientSecret: attempt.clientSecret, chargeId: charge.id }
    }
    return { state: 'declined', message: attempt.error ?? attempt.charge.failure_message, chargeId: charge.id }
}

/** Cancels an intent nobody will finish and closes its row as failed. */
async function abandonCharge(admin: AdminClient, charge: ChargeRow, reason: string): Promise<void> {
    if (charge.stripe_payment_intent_id) {
        await getStripe().paymentIntents.cancel(charge.stripe_payment_intent_id).catch(() => undefined)
    }
    await admin
        .from('booking_charges')
        .update({ status: 'failed', failure_message: reason, settled_at: new Date().toISOString() })
        .eq('id', charge.id)
        .in('status', ['requires_payment', 'processing'])
}

async function applyDepositEffects(admin: AdminClient, charge: ChargeRow): Promise<void> {
    const renewal = Boolean(charge.renews_charge_id)

    if (charge.status === 'authorized') {
        // The replacement is in place, so the hold it replaces can go. Silent:
        // the guest is told about the renewal, not about the mechanics.
        if (charge.renews_charge_id) {
            const old = await loadCharge(admin, charge.renews_charge_id)
            if (old && old.status === 'authorized') await releaseDepositHold(admin, old, { notifyGuest: false })
        }
        await sendDepositHeldEmail(admin, charge.id, renewal)
        return
    }

    if (charge.status === 'failed') {
        // Once per run of failures, not once per retry every six hours.
        const rows = await depositRows(admin, charge.booking_id)
        const index = rows.findIndex(r => r.id === charge.id)
        const previous = index >= 0 ? rows[index + 1] : undefined
        if (!previous || previous.status !== 'failed') {
            await sendDepositDeclinedEmails(admin, charge.id, renewal)
        }
    }
}

/**
 * Lets a hold go. The conditional update is the claim: only one caller — the
 * sweep, an owner's button, a cancellation — gets to release it and send the email.
 */
export async function releaseDepositHold(
    admin: AdminClient,
    charge: ChargeRow,
    options: { notifyGuest: boolean },
): Promise<boolean> {
    if (charge.kind !== 'deposit' || charge.status !== 'authorized' || !charge.stripe_payment_intent_id) return false

    const { data: claimed } = await admin
        .from('booking_charges')
        .update({ status: 'canceled', settled_at: new Date().toISOString() })
        .eq('id', charge.id)
        .eq('status', 'authorized')
        .select(CHARGE_SELECT)
        .maybeSingle()
    if (!claimed) return false

    try {
        await getStripe().paymentIntents.cancel(charge.stripe_payment_intent_id)
    } catch (err: any) {
        // Put it back: a hold we couldn't release is still a hold.
        await admin.from('booking_charges').update({ status: 'authorized', settled_at: null }).eq('id', charge.id)
        throw new Error(`Could not release the hold: ${err?.message ?? 'Stripe error'}`)
    }

    if (options.notifyGuest) await sendDepositReleasedEmail(admin, toChargeRow(claimed))
    return true
}

/**
 * Keeps some or all of a hold — damage found at inspection. What isn't captured
 * is released by Stripe in the same step. Anything owed beyond the hold is a
 * separate adjustment charge.
 */
export async function captureDeposit(admin: AdminClient, charge: ChargeRow, amount: number, reason: string): Promise<ChargeRow> {
    if (charge.kind !== 'deposit' || charge.status !== 'authorized' || !charge.stripe_payment_intent_id) {
        throw new Error('This hold is no longer on the card.')
    }
    if (!(amount > 0) || amount > charge.amount + 0.001) {
        throw new Error(`Capture must be between $0.01 and $${charge.amount.toFixed(2)}.`)
    }
    const why = reason.trim()
    if (!why) throw new Error('Say what the capture is for. The guest is told.')

    // The reason becomes the line item the receipt shows.
    await admin
        .from('booking_charges')
        .update({ line_items: [{ label: why, amount: roundMoney(amount) }] })
        .eq('id', charge.id)

    const intent = await getStripe().paymentIntents.capture(
        charge.stripe_payment_intent_id,
        { amount_to_capture: toCents(amount), expand: ['latest_charge'] },
        { idempotencyKey: `capture_${charge.id}` },
    )
    const synced = (await syncChargeFromIntent(admin, intent)) ?? charge
    await sendDepositCapturedEmail(admin, synced, why)
    return synced
}

// ═══════════════════════════════════════════════════════════════════════════
// Trip extensions
// ═══════════════════════════════════════════════════════════════════════════

export type ExtensionRow = {
    id: string
    booking_id: string
    from_end_time: string
    to_end_time: string
    mode: 'instant' | 'request'
    status: 'pending' | 'requested' | 'confirmed' | 'declined' | 'expired' | 'failed' | 'canceled'
    quote: ExtensionQuote
    amount: number
    charge_id: string | null
    created_at: string
    decided_at: string | null
}

const EXTENSION_SELECT =
    'id, booking_id, from_end_time, to_end_time, mode, status, quote, amount, charge_id, created_at, decided_at'

function toExtensionRow(row: any): ExtensionRow {
    return { ...row, amount: Number(row.amount) || 0 }
}

export async function loadExtensions(admin: AdminClient, bookingId: string): Promise<ExtensionRow[]> {
    const { data } = await admin
        .from('booking_extensions')
        .select(EXTENSION_SELECT)
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: true })
    return (data ?? []).map(toExtensionRow)
}

export type ExtensionPreview = {
    mode: ExtensionMode
    newEndIso: string
    quote: ExtensionQuote
    taxLines: TaxLine[]
    taxTotal: number
    total: number
}

/**
 * Prices an extension of this booking to a new wall-clock end. The same function
 * the page previews with and requestExtension charges with.
 */
export async function previewExtension(
    admin: AdminClient,
    bookingId: string,
    newEndDate: string,
    newEndTime: string,
    now: Date = new Date(),
): Promise<ExtensionPreview> {
    const { booking } = await loadBillingContext(admin, bookingId)
    if (booking.status !== 'confirmed') throw new Error('Only a confirmed trip can be extended.')

    const currentEnd = new Date(booking.end_time)
    const mode = extensionMode(currentEnd, now)
    if (mode === 'closed') {
        throw new Error('This trip has already ended, so it can’t be extended. If you’re running late, call us.')
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(newEndDate) || !/^\d{1,2}:\d{2}$/.test(newEndTime)) {
        throw new Error('Choose a new return date and time.')
    }
    const [h = 0, m = 0] = newEndTime.split(':').map(Number)
    const minutes = h * 60 + m
    if (minutes % SLOT_MINUTES !== 0 || minutes < BUSINESS_OPEN_MINUTES || minutes > BUSINESS_CLOSE_MINUTES) {
        throw new Error('Returns have to be during business hours, on the half hour.')
    }

    const newEndIso = wallClockToUtcIso(newEndDate, newEndTime)
    if (new Date(newEndIso) <= currentEnd) throw new Error('The new return has to be later than the current one.')

    const start = new Date(booking.start_time)
    const { data: overrideRows } = await admin
        .from('car_price_overrides')
        .select('date, price')
        .eq('car_id', booking.car_id)
        .gte('date', businessDateKey(currentEnd))

    const { data: extraRows } = await admin
        .from('booking_extras')
        .select('extra_id')
        .eq('booking_id', bookingId)
        .eq('status', 'approved')

    const quote = calculateExtensionPrice({
        startDate: businessDateKey(start),
        startTime: businessWallClockTime(start),
        currentEndDate: businessDateKey(currentEnd),
        currentEndTime: businessWallClockTime(currentEnd),
        newEndDate,
        newEndTime,
        basePricePerDay: Number(booking.cars?.price_per_day),
        overrides: buildOverrideMap(overrideRows ?? []),
        bookingRate: (booking.booking_rate ?? DEFAULT_BOOKING_RATE) as BookingRate,
        tripExtraIds: (extraRows ?? []).map((r: any) => r.extra_id as string),
    })

    const tax = calculateTax(extensionTaxableLines(quote), taxContextFor(booking))
    return { mode, newEndIso, quote, taxLines: tax.lines, taxTotal: tax.total, total: roundMoney(quote.total + tax.total) }
}

function extensionTaxableLines(quote: ExtensionQuote) {
    const trip = roundMoney(quote.total - quote.extrasTotal)
    return [
        ...(trip > 0 ? [{ taxKey: 'trip', amount: trip }] : []),
        ...quote.extras.map(extra => ({ taxKey: `extra:${extra.id}`, amount: extra.amount })),
    ]
}

function extensionLineItems(quote: ExtensionQuote): ChargeLineItem[] {
    const items: ChargeLineItem[] = []
    const first = quote.days[0]
    const last = quote.days[quote.days.length - 1]
    if (first && last) {
        const n = quote.days.length
        items.push({
            label: 'Added days',
            detail: `${n} ${n === 1 ? 'day' : 'days'}, ${formatDayRange(first.date, last.date)}`,
            amount: quote.subtotal,
        })
    }
    if (quote.discountAmount > 0) items.push({ label: quote.discountLabel ?? 'Discount', amount: -quote.discountAmount })
    if (quote.extraDiscountAmount > 0) {
        items.push({ label: quote.extraDiscountLabel ?? 'Discount', amount: -quote.extraDiscountAmount })
    }
    if (quote.refundableSurchargeAmount > 0) {
        items.push({ label: quote.refundableSurchargeLabel ?? 'Refundable rate', amount: quote.refundableSurchargeAmount })
    }
    for (const extra of quote.extras) {
        items.push({ label: extra.name, detail: `${extra.quantity} ${extra.quantity === 1 ? 'day' : 'days'}`, amount: extra.amount })
    }
    return items
}

export type ExtensionResult = {
    extension: ExtensionRow
    clientSecret: string | null
    needsAction: boolean
    error: string | null
}

/**
 * Extends a trip, or asks to.
 *
 * The extension row is inserted before any money moves, so its added time is
 * held against other renters for as long as the payment takes (and, for a
 * request, until an owner answers). Instant: charged now, applied on success.
 * Request (inside the last hour): the card is held, an owner decides.
 */
export async function startExtension(
    admin: AdminClient,
    input: { bookingId: string; newEndDate: string; newEndTime: string; createdBy: string; callerIsAdmin: boolean },
): Promise<ExtensionResult> {
    const preview = await previewExtension(admin, input.bookingId, input.newEndDate, input.newEndTime)
    const { booking, customerId, paymentMethodId } = await loadBillingContext(admin, input.bookingId)

    // Whoever clicked is the one present. The guest is there if they're the one
    // extending — even when their account is also an admin. Only an admin
    // extending *someone else's* trip charges the card without the guest there
    // (off-session: no authentication pop-up, pay link if the bank insists).
    // Deciding this from "is an admin" alone sent an owner's own 3D Secure test
    // down the off-session path on 2026-09-29.
    const guestPresent = !input.callerIsAdmin || booking.user_id === input.createdBy

    await assertCarIsAvailable(booking.car_id, booking.end_time, preview.newEndIso, { excludeBookingId: booking.id })

    if (preview.total > 0 && (!customerId || !paymentMethodId)) {
        throw new Error('There’s no card saved on this trip. Update your card first, then extend.')
    }

    const { data: inserted, error } = await admin
        .from('booking_extensions')
        .insert({
            booking_id: booking.id,
            from_end_time: booking.end_time,
            to_end_time: preview.newEndIso,
            mode: preview.mode,
            status: 'pending',
            quote: { ...preview.quote, taxLines: preview.taxLines, taxTotal: preview.taxTotal },
            amount: preview.total,
            created_by: input.createdBy,
        })
        .select(EXTENSION_SELECT)
        .single()
    if (error) {
        if ((error as any).code === '23505') throw new Error('This trip already has an extension in progress.')
        throw new Error(error.message)
    }
    let extension = toExtensionRow(inserted)

    // Nothing to charge: the added time is inside a day already paid for.
    if (preview.total <= 0) {
        if (preview.mode === 'instant') {
            await confirmExtension(admin, extension)
        } else {
            await admin.from('booking_extensions').update({ status: 'requested' }).eq('id', extension.id)
            await sendExtensionEmail(admin, { ...extension, status: 'requested' }, 'requested')
        }
        return { extension: (await loadExtension(admin, extension.id)) ?? extension, clientSecret: null, needsAction: false, error: null }
    }

    const charge = await insertCharge(admin, {
        bookingId: booking.id,
        kind: 'extension',
        description: extensionDescription(preview.newEndIso),
        amount: preview.quote.total,
        taxLines: preview.taxLines,
        taxAmount: preview.taxTotal,
        lineItems: extensionLineItems(preview.quote),
        initiatedBy: guestPresent ? 'guest' : 'admin',
        createdBy: input.createdBy,
    })

    await admin.from('booking_extensions').update({ charge_id: charge.id }).eq('id', extension.id)
    extension = { ...extension, charge_id: charge.id }

    const attempt = await chargeSavedCard(admin, charge, {
        customerId: customerId!,
        paymentMethodId: paymentMethodId!,
        capture: preview.mode === 'instant' ? 'automatic' : 'manual',
        offSession: !guestPresent,
    })

    return {
        extension: (await loadExtension(admin, extension.id)) ?? extension,
        clientSecret: attempt.clientSecret,
        needsAction: attempt.needsAction,
        error: attempt.charge.status === 'requires_payment' || attempt.charge.status === 'failed' ? attempt.error : null,
    }
}

function extensionDescription(newEndIso: string): string {
    return `Trip extended to ${formatBusinessDateTime(newEndIso)}`
}

export async function loadExtension(admin: AdminClient, extensionId: string): Promise<ExtensionRow | null> {
    const { data } = await admin.from('booking_extensions').select(EXTENSION_SELECT).eq('id', extensionId).maybeSingle()
    return data ? toExtensionRow(data) : null
}

/**
 * Applies a paid (or free) extension: the trip's end moves. Claimed on the
 * extension's status, and conditional on the trip still ending where the
 * extension started, so nothing can apply twice or on top of another change.
 */
async function confirmExtension(admin: AdminClient, extension: ExtensionRow): Promise<void> {
    const { data: claimed } = await admin
        .from('booking_extensions')
        .update({ status: 'confirmed', decided_at: extension.decided_at ?? new Date().toISOString() })
        .eq('id', extension.id)
        .in('status', ['pending', 'requested'])
        .select(EXTENSION_SELECT)
        .maybeSingle()
    if (!claimed) return

    const { data: moved } = await admin
        .from('bookings')
        .update({ end_time: extension.to_end_time })
        .eq('id', extension.booking_id)
        .eq('end_time', extension.from_end_time)
        .eq('status', 'confirmed')
        .select('id')
        .maybeSingle()

    if (!moved) {
        await sendAdminAlert(admin, {
            subject: 'Extension paid but not applied',
            lines: [
                `An extension to ${extension.to_end_time} was confirmed, but the trip no longer ended at ${extension.from_end_time} (or is no longer confirmed), so its end time was not moved.`,
                'Check the reservation and adjust the end time or refund the extension by hand.',
            ],
            bookingId: extension.booking_id,
        })
        return
    }

    await sendExtensionEmail(admin, toExtensionRow(claimed), 'confirmed')
}

async function applyExtensionEffects(admin: AdminClient, charge: ChargeRow): Promise<void> {
    const { data } = await admin.from('booking_extensions').select(EXTENSION_SELECT).eq('charge_id', charge.id).maybeSingle()
    if (!data) return
    const extension = toExtensionRow(data)

    if (charge.status === 'succeeded') {
        await confirmExtension(admin, extension)
    } else if (charge.status === 'authorized' && extension.mode === 'request' && extension.status === 'pending') {
        const { data: moved } = await admin
            .from('booking_extensions')
            .update({ status: 'requested' })
            .eq('id', extension.id)
            .eq('status', 'pending')
            .select(EXTENSION_SELECT)
            .maybeSingle()
        if (moved) await sendExtensionEmail(admin, toExtensionRow(moved), 'requested')
    } else if (charge.status === 'canceled' || charge.status === 'failed') {
        await admin
            .from('booking_extensions')
            .update({ status: charge.status === 'failed' ? 'failed' : 'expired' })
            .eq('id', extension.id)
            .in('status', ['pending', 'requested'])
    }
}

/** An owner answering a last-hour extension request. */
export async function decideExtension(
    admin: AdminClient,
    extensionId: string,
    approve: boolean,
    decidedBy: string,
): Promise<ExtensionRow> {
    const extension = await loadExtension(admin, extensionId)
    if (!extension) throw new Error('Extension not found')
    if (extension.status !== 'requested') throw new Error('This extension has already been answered.')

    const charge = extension.charge_id ? await loadCharge(admin, extension.charge_id) : null

    if (approve) {
        await admin.from('booking_extensions').update({ decided_by: decidedBy, decided_at: new Date().toISOString() }).eq('id', extension.id)
        if (charge && charge.status === 'authorized' && charge.stripe_payment_intent_id) {
            const intent = await getStripe().paymentIntents.capture(
                charge.stripe_payment_intent_id,
                { expand: ['latest_charge'] },
                { idempotencyKey: `capture_${charge.id}` },
            )
            await syncChargeFromIntent(admin, intent) // succeeded -> confirmExtension
        } else if (!charge) {
            await confirmExtension(admin, extension)
        } else {
            throw new Error('The hold for this extension is no longer on the card. Decline it and ask the guest to request again.')
        }
    } else {
        const { data: claimed } = await admin
            .from('booking_extensions')
            .update({ status: 'declined', decided_by: decidedBy, decided_at: new Date().toISOString() })
            .eq('id', extension.id)
            .eq('status', 'requested')
            .select(EXTENSION_SELECT)
            .maybeSingle()
        if (!claimed) throw new Error('This extension has already been answered.')
        if (charge?.stripe_payment_intent_id && charge.status === 'authorized') {
            await getStripe().paymentIntents.cancel(charge.stripe_payment_intent_id).catch(() => undefined)
            await admin.from('booking_charges').update({ status: 'canceled', settled_at: new Date().toISOString() })
                .eq('id', charge.id).eq('status', 'authorized')
        }
        await sendExtensionEmail(admin, toExtensionRow(claimed), 'declined')
    }

    return (await loadExtension(admin, extensionId)) ?? extension
}

// ═══════════════════════════════════════════════════════════════════════════
// Post-booking extras
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Holds the card for one requested extra. One hold per extra, because each is
 * approved or declined on its own and a hold can only be captured once.
 */
export async function holdExtraRequest(
    admin: AdminClient,
    input: { bookingId: string; extra: { id: string; name: string; amount: number; quantity: number; billing: string }; createdBy: string },
): Promise<ChargeAttempt> {
    const { booking, customerId, paymentMethodId } = await loadBillingContext(admin, input.bookingId)
    if (!customerId || !paymentMethodId) {
        throw new Error('There’s no card saved on this trip. Update your card first, then request extras.')
    }
    const tax = calculateTax([{ taxKey: `extra:${input.extra.id}`, amount: input.extra.amount }], taxContextFor(booking))
    const charge = await insertCharge(admin, {
        bookingId: input.bookingId,
        kind: 'extra',
        category: input.extra.id,
        description: input.extra.name,
        amount: input.extra.amount,
        taxLines: tax.lines,
        taxAmount: tax.total,
        lineItems: [{
            label: input.extra.name,
            detail: input.extra.billing === 'per-day' ? `${input.extra.quantity} days` : undefined,
            amount: input.extra.amount,
        }],
        initiatedBy: 'guest',
        createdBy: input.createdBy,
    })
    return chargeSavedCard(admin, charge, { customerId, paymentMethodId, capture: 'manual', offSession: false })
}

async function applyExtraEffects(admin: AdminClient, charge: ChargeRow): Promise<void> {
    if (charge.status === 'succeeded') {
        await admin.from('booking_extras').update({ charged: true }).eq('charge_id', charge.id)
    }
}

/** Approve captures the extra's hold; decline releases it. */
export async function settleExtraDecision(admin: AdminClient, chargeId: string, approve: boolean): Promise<void> {
    const charge = await loadCharge(admin, chargeId)
    if (!charge || !charge.stripe_payment_intent_id) return
    const stripe = getStripe()

    if (approve) {
        if (charge.status !== 'authorized') {
            throw new Error('The hold for this extra is no longer on the card, so it can’t be charged. Collect it at pickup or decline it.')
        }
        const intent = await stripe.paymentIntents.capture(
            charge.stripe_payment_intent_id,
            { expand: ['latest_charge'] },
            { idempotencyKey: `capture_${charge.id}` },
        )
        await syncChargeFromIntent(admin, intent)
    } else if (charge.status === 'authorized' || charge.status === 'requires_payment') {
        await stripe.paymentIntents.cancel(charge.stripe_payment_intent_id).catch(() => undefined)
        await admin.from('booking_charges').update({ status: 'canceled', settled_at: new Date().toISOString() })
            .eq('id', charge.id).in('status', ['authorized', 'requires_payment'])
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Updating the card on a trip
// ═══════════════════════════════════════════════════════════════════════════

/** A SetupIntent the trip page confirms to save a new card to this trip. */
export async function startCardUpdate(admin: AdminClient, bookingId: string): Promise<string> {
    const { booking } = await loadBillingContext(admin, bookingId)
    const customerId = await getOrCreateCustomer(admin, booking.user_id)
    const intent = await getStripe().setupIntents.create({
        customer: customerId,
        payment_method_types: CARD_ONLY,
        usage: 'off_session',
        metadata: { kind: 'card-update', bookingId },
    })
    if (!intent.client_secret) throw new Error('Could not start the card update')
    return intent.client_secret
}

/**
 * Records a card the guest just saved, and — if the trip is waiting on its
 * deposit — tries the hold right away, on-session, so the bank can ask the guest
 * to authenticate while they're still on the page.
 */
export async function finishCardUpdate(
    admin: AdminClient,
    bookingId: string,
    setupIntent: Stripe.SetupIntent,
): Promise<DepositAttempt> {
    if (setupIntent.metadata?.bookingId !== bookingId || setupIntent.metadata?.kind !== 'card-update') {
        throw new Error('That card update belongs to a different trip.')
    }
    if (setupIntent.status !== 'succeeded') throw new Error('The card was not saved.')

    const pm = idOf(setupIntent.payment_method as any)
    const customer = idOf(setupIntent.customer as any)
    if (!pm) throw new Error('The card was not saved.')
    await recordBookingPaymentMethod(admin, bookingId, pm, customer)

    return ensureDepositHold(admin, bookingId, { onSession: true, force: true, initiatedBy: 'guest' })
}

// ═══════════════════════════════════════════════════════════════════════════
// Cancelling a trip with charges after checkout
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Where the trip ended when it was booked, before any extension moved it. The
 * checkout charge's refund is about that trip, not the extended one.
 */
export async function originalEndTime(admin: AdminClient, bookingId: string, currentEnd: string): Promise<string> {
    const { data } = await admin
        .from('booking_extensions')
        .select('from_end_time')
        .eq('booking_id', bookingId)
        .eq('status', 'confirmed')
        .order('created_at', { ascending: true })
        .limit(1)
    return (data?.[0]?.from_end_time as string | undefined) ?? currentEnd
}

/** The paid extensions and later extras, in the shape laterChargeRefund takes. */
export async function laterChargesFor(admin: AdminClient, bookingId: string): Promise<LaterCharge[]> {
    const charges = (await loadCharges(admin, bookingId))
        .filter(c => (c.kind === 'extension' || c.kind === 'extra') && c.status === 'succeeded')
    const extensions = await loadExtensions(admin, bookingId)

    return charges.map(c => ({
        id: c.id,
        kind: c.kind as 'extension' | 'extra',
        amount: c.amount,
        tax: c.tax_amount,
        captured: c.amount_captured,
        refunded: c.amount_refunded,
        refundablePremium: c.kind === 'extension'
            ? Number(extensions.find(e => e.charge_id === c.id)?.quote?.refundableSurchargeAmount ?? 0)
            : 0,
    }))
}

/**
 * Everything a cancelled trip's ledger needs, after the checkout charge has been
 * refunded (ImportantFiles/cancellation-and-refunds.md):
 *   - deposit holds released;
 *   - holds for unanswered extras and extension requests released, and
 *     unfinished extension payments abandoned;
 *   - paid extensions and later extras refunded by laterChargeRefund;
 *   - owners' charges left alone — refunded by hand if at all.
 *
 * Never throws: the trip is cancelled whatever happens here, and a refund that
 * fails is reported to the owners to settle by hand. Returns what was refunded.
 */
export async function settleLedgerOnCancellation(
    admin: AdminClient,
    bookingId: string,
    outcome: Pick<RefundOutcome, 'kind'>,
): Promise<number> {
    let refunded = 0
    const problems: string[] = []

    try {
        const charges = await loadCharges(admin, bookingId)
        const later = await laterChargesFor(admin, bookingId)

        for (const charge of charges) {
            try {
                if (charge.kind === 'deposit' && charge.status === 'authorized') {
                    await releaseDepositHold(admin, charge, { notifyGuest: true })
                } else if ((charge.kind === 'extra' || charge.kind === 'extension')
                    && (charge.status === 'authorized' || charge.status === 'requires_payment' || charge.status === 'processing')) {
                    if (charge.stripe_payment_intent_id) {
                        await getStripe().paymentIntents.cancel(charge.stripe_payment_intent_id).catch(() => undefined)
                    }
                    await admin.from('booking_charges').update({ status: 'canceled', settled_at: new Date().toISOString() })
                        .eq('id', charge.id).in('status', ['authorized', 'requires_payment', 'processing'])
                } else if (charge.status === 'succeeded' && (charge.kind === 'extra' || charge.kind === 'extension')) {
                    const input = later.find(l => l.id === charge.id)
                    const amount = input ? laterChargeRefund(outcome, input) : 0
                    if (amount > 0) {
                        await refundCharge(admin, charge, amount, 'Trip cancelled')
                        refunded = roundMoney(refunded + amount)
                    }
                }
            } catch (err: any) {
                problems.push(`${charge.description}: ${err?.message ?? err}`)
            }
        }

        // The requests themselves: an unanswered extension or extra on a trip
        // that's no longer happening is answered by the cancellation.
        await admin.from('booking_extensions').update({ status: 'canceled' })
            .eq('booking_id', bookingId).in('status', ['pending', 'requested'])
        await admin.from('booking_extras').update({ status: 'declined', decided_at: new Date().toISOString() })
            .eq('booking_id', bookingId).eq('status', 'requested')
    } catch (err: any) {
        problems.push(err?.message ?? String(err))
    }

    if (problems.length) {
        await sendAdminAlert(admin, {
            subject: 'A cancelled trip’s later charges need attention',
            lines: ['The trip was cancelled, but some of its later charges could not be settled automatically:', ...problems],
            bookingId,
        })
    }
    return refunded
}

// ═══════════════════════════════════════════════════════════════════════════
// The sweep — every 15 minutes, from /api/cron/payments
// ═══════════════════════════════════════════════════════════════════════════

export type SweepResult = {
    holdsAttempted: number
    holdsRenewed: number
    holdsReleased: number
    extensionsExpired: number
    errors: string[]
}

export async function runPaymentsSweep(admin: AdminClient, now: Date = new Date()): Promise<SweepResult> {
    const result: SweepResult = { holdsAttempted: 0, holdsRenewed: 0, holdsReleased: 0, extensionsExpired: 0, errors: [] }
    const note = (what: string, err: any) => result.errors.push(`${what}: ${err?.message ?? String(err)}`)

    // 1 & 2. Place (or retry) holds for trips starting within the window.
    try {
        const placeBy = new Date(now.getTime() + DEPOSIT_PLACE_BEFORE_HOURS * MS_PER_HOUR).toISOString()
        const { data: due } = await admin
            .from('bookings')
            .select('id, start_time, end_time')
            .eq('status', 'confirmed')
            .is('deposit_waived_at', null)
            .lte('start_time', placeBy)
            .gt('end_time', new Date(now.getTime() - DEPOSIT_RELEASE_AFTER_HOURS * MS_PER_HOUR).toISOString())
        for (const booking of due ?? []) {
            if (now < depositPlaceAt(new Date(booking.start_time))) continue
            try {
                const attempt = await ensureDepositHold(admin, booking.id, { now, initiatedBy: 'system' })
                if (['placed', 'declined', 'needs-action'].includes(attempt.state)) result.holdsAttempted++
            } catch (err) { note(`hold ${booking.id}`, err) }
        }
    } catch (err) { note('placing holds', err) }

    // 3. Renew holds that would expire while still needed.
    try {
        const renewBy = new Date(now.getTime() + DEPOSIT_RENEW_BEFORE_HOURS * MS_PER_HOUR).toISOString()
        const { data: expiring } = await admin
            .from('booking_charges')
            .select(`${CHARGE_SELECT}, bookings!inner(status, end_time, user_id, payment_method_id)`)
            .eq('kind', 'deposit')
            .eq('status', 'authorized')
            .not('capture_before', 'is', null)
            .lte('capture_before', renewBy)
        for (const raw of expiring ?? []) {
            const hold = toChargeRow(raw)
            const booking = (raw as any).bookings
            try {
                const stillNeeded = booking.status === 'confirmed'
                    && depositReleaseAt(new Date(booking.end_time)) > new Date(hold.capture_before!)
                if (!stillNeeded) continue
                // Already replaced (or being replaced)?
                const { data: newer } = await admin
                    .from('booking_charges')
                    .select('id')
                    .eq('renews_charge_id', hold.id)
                    .in('status', ['requires_payment', 'processing', 'authorized'])
                    .limit(1)
                if (newer && newer.length) continue

                const { customerId, paymentMethodId } = await loadBillingContext(admin, hold.booking_id)
                if (!customerId || !paymentMethodId) continue
                await placeDepositHold(admin, hold.booking_id, {
                    customerId,
                    paymentMethodId,
                    onSession: false,
                    initiatedBy: 'system',
                    renewsChargeId: hold.id,
                })
                result.holdsRenewed++
            } catch (err) { note(`renew ${hold.id}`, err) }
        }
    } catch (err) { note('renewing holds', err) }

    // 4. Release holds once the inspection window after the trip has passed,
    //    and any hold left on a trip that was cancelled.
    try {
        const { data: held } = await admin
            .from('booking_charges')
            .select(`${CHARGE_SELECT}, bookings!inner(status, end_time)`)
            .eq('kind', 'deposit')
            .eq('status', 'authorized')
            .eq('keep_holding', false)
        for (const raw of held ?? []) {
            const hold = toChargeRow(raw)
            const booking = (raw as any).bookings
            const over = now >= depositReleaseAt(new Date(booking.end_time))
            const tripOff = booking.status === 'canceled'
            if (!over && !tripOff) continue
            try {
                if (await releaseDepositHold(admin, hold, { notifyGuest: true })) result.holdsReleased++
            } catch (err) { note(`release ${hold.id}`, err) }
        }
    } catch (err) { note('releasing holds', err) }

    // 5. Extension payments nobody finished: let the added time go.
    try {
        const cutoff = new Date(now.getTime() - PENDING_HOLD_MS).toISOString()
        const { data: stale } = await admin
            .from('booking_extensions')
            .select(EXTENSION_SELECT)
            .eq('status', 'pending')
            .lt('created_at', cutoff)
        for (const raw of stale ?? []) {
            const extension = toExtensionRow(raw)
            try {
                const charge = extension.charge_id ? await loadCharge(admin, extension.charge_id) : null
                if (charge && (charge.status === 'requires_payment' || charge.status === 'processing')) {
                    await abandonCharge(admin, charge, 'Payment was not completed')
                }
                const { data: expired } = await admin
                    .from('booking_extensions')
                    .update({ status: 'expired' })
                    .eq('id', extension.id)
                    .eq('status', 'pending')
                    .select('id')
                    .maybeSingle()
                if (expired) result.extensionsExpired++
            } catch (err) { note(`extension ${extension.id}`, err) }
        }
    } catch (err) { note('expiring extensions', err) }

    return result
}