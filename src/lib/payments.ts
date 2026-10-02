// Server functions for money after checkout — what the trip page, the pay page
// and the admin reservation page call.
//
// Thin on purpose: each one authorizes the caller and hands off to
// src/lib/payments.server.ts, which holds the rules. Every function checks
// access itself (assertBookingAccess / requireAdmin), because a server function
// can be called directly, not only from the page it was written for.
//
// Imported by browser pages, so nothing here is a plain exported function —
// only createServerFn, whose handler bodies are stripped from the client bundle.

import { createServerFn } from '@tanstack/react-start'
import { assertBookingAccess, getServiceRoleClient, requireAdmin } from './access.server'
import {
    captureDeposit,
    createAdjustmentCharge,
    decideExtension,
    ensureDepositHold,
    finishCardUpdate,
    getStripe,
    loadCharge,
    loadCharges,
    loadExtensions,
    preparePayLink,
    previewExtension,
    refreshCharge,
    refundCharge,
    releaseDepositHold,
    startCardUpdate,
    startExtension,
} from './payments.server'
import { depositStateFor } from './lockbox.server'
import { isChargeCategory } from './charges'
import { EXTENSION_REQUEST_CUTOFF_MINUTES } from './extension'
import { storedQuote } from './receipt'
import { businessDateKey } from './dates'
import { taxContextFromQuote, type TaxLine } from './tax'
import type { TaxedSale } from './tax-report'

const MAX_DESCRIPTION = 500
const MAX_REASON = 500

/** A charge row, checked to belong to the booking the caller may access. */
async function chargeOnBooking(bookingId: string, chargeId: string) {
    const access = await assertBookingAccess(bookingId)
    const charge = await loadCharge(access.supabaseAdmin, chargeId)
    if (!charge || charge.booking_id !== bookingId) throw new Error('Charge not found')
    return { ...access, charge }
}

/** A charge row for an owner, by id alone. */
async function chargeForAdmin(chargeId: string) {
    const { user } = await requireAdmin()
    const supabaseAdmin = getServiceRoleClient()
    const charge = await loadCharge(supabaseAdmin, chargeId)
    if (!charge) throw new Error('Charge not found')
    return { user, supabaseAdmin, charge }
}

// ── Reading ──────────────────────────────────────────────────────────────────

export type TripCard = { brand: string; last4: string } | null

/**
 * Everything the trip and reservation pages show about money after checkout:
 * the ledger, the extensions, the deposit, and which card is on file.
 */
export const getTripPayments = createServerFn({ method: 'GET' })
    .inputValidator((bookingId: string) => bookingId)
    .handler(async ({ data: bookingId }) => {
        const { supabaseAdmin, isAdmin } = await assertBookingAccess(bookingId)

        const { data: booking, error } = await supabaseAdmin
            .from('bookings')
            .select('id, status, start_time, end_time, payment_method_id, deposit_waived_at')
            .eq('id', bookingId)
            .single()
        if (error || !booking) throw new Error('Booking not found')

        const [charges, extensions, depositState] = await Promise.all([
            loadCharges(supabaseAdmin, bookingId),
            loadExtensions(supabaseAdmin, bookingId),
            depositStateFor(supabaseAdmin, booking),
        ])

        // Brand and last four only — enough for "Visa ending 4242", nothing a
        // page could misuse.
        let card: TripCard = null
        if (booking.payment_method_id) {
            try {
                const pm = await getStripe().paymentMethods.retrieve(booking.payment_method_id)
                if (pm.card) card = { brand: pm.card.brand, last4: pm.card.last4 }
                else if (pm.type === 'link') card = { brand: 'link', last4: '' }
            } catch (err: any) {
                console.warn('[payments] could not read the saved card:', err?.message)
            }
        }

        const deposits = charges.filter(c => c.kind === 'deposit')
        const activeDeposit =
            [...deposits].reverse().find(c => c.status === 'authorized') ??
            [...deposits].reverse().find(c => c.status === 'succeeded') ??
            deposits[deposits.length - 1] ??
            null

        return {
            isAdmin,
            charges: charges.filter(c => c.kind !== 'deposit'),
            extensions,
            deposit: {
                state: depositState,
                charge: activeDeposit,
                history: deposits,
                waivedAt: booking.deposit_waived_at as string | null,
            },
            card,
            hasCard: Boolean(booking.payment_method_id),
            extensionRequestCutoffMinutes: EXTENSION_REQUEST_CUTOFF_MINUTES,
        }
    })

// ── Extensions ───────────────────────────────────────────────────────────────

type ExtensionInput = { bookingId: string; newEndDate: string; newEndTime: string }

export const quoteTripExtension = createServerFn({ method: 'POST' })
    .inputValidator((input: ExtensionInput) => input)
    .handler(async ({ data }) => {
        const { supabaseAdmin } = await assertBookingAccess(data.bookingId)
        return previewExtension(supabaseAdmin, data.bookingId, data.newEndDate, data.newEndTime)
    })

/**
 * Extends the trip, or asks to. The price is recomputed here; nothing about it
 * is taken from the browser but the new end.
 */
export const requestTripExtension = createServerFn({ method: 'POST' })
    .inputValidator((input: ExtensionInput) => input)
    .handler(async ({ data }) => {
        const { supabaseAdmin, user, isAdmin } = await assertBookingAccess(data.bookingId)
        const result = await startExtension(supabaseAdmin, {
            bookingId: data.bookingId,
            newEndDate: data.newEndDate,
            newEndTime: data.newEndTime,
            createdBy: user.id,
            // startExtension decides whether the guest is present: yes if the
            // caller owns the booking, even when they're also an admin.
            callerIsAdmin: isAdmin,
        })
        return {
            extension: result.extension,
            clientSecret: result.needsAction ? result.clientSecret : null,
            needsAction: result.needsAction,
            error: result.error,
        }
    })

export const decideTripExtension = createServerFn({ method: 'POST' })
    .inputValidator((input: { extensionId: string; approve: boolean }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        return decideExtension(getServiceRoleClient(), data.extensionId, data.approve, user.id)
    })

// ── Paying a charge the saved card couldn't ─────────────────────────────────

/** The pay page's loader: the charge, and a client secret to pay it with. */
export const getChargePayLink = createServerFn({ method: 'GET' })
    .inputValidator((input: { bookingId: string; chargeId: string }) => input)
    .handler(async ({ data }) => {
        const { supabaseAdmin, charge } = await chargeOnBooking(data.bookingId, data.chargeId)
        const { clientSecret, paid } = await preparePayLink(supabaseAdmin, charge)
        return { charge: (await loadCharge(supabaseAdmin, charge.id)) ?? charge, clientSecret, paid }
    })

/**
 * Called by the page once the guest has authenticated or paid, to bring the
 * ledger up to date without waiting for the webhook — the same backup
 * confirmBooking is for checkout.
 */
export const finishChargePayment = createServerFn({ method: 'POST' })
    .inputValidator((input: { bookingId: string; chargeId: string }) => input)
    .handler(async ({ data }) => {
        const { supabaseAdmin, charge } = await chargeOnBooking(data.bookingId, data.chargeId)
        const updated = await refreshCharge(supabaseAdmin, charge)
        const extension = updated.kind === 'extension'
            ? (await loadExtensions(supabaseAdmin, data.bookingId)).find(e => e.charge_id === updated.id) ?? null
            : null
        return { charge: updated, extension }
    })

// ── The card on a trip ───────────────────────────────────────────────────────

export const startTripCardUpdate = createServerFn({ method: 'POST' })
    .inputValidator((bookingId: string) => bookingId)
    .handler(async ({ data: bookingId }) => {
        const { supabaseAdmin, isAdmin, user } = await assertBookingAccess(bookingId)
        // A card is the guest's to give. An owner can't add one on their behalf.
        const { data: booking } = await supabaseAdmin.from('bookings').select('user_id').eq('id', bookingId).single()
        if (isAdmin && booking?.user_id !== user.id) throw new Error('Only the guest can add a card to their trip.')
        return { clientSecret: await startCardUpdate(supabaseAdmin, bookingId) }
    })

/**
 * Records the card the guest just saved and, if the trip is waiting on its
 * deposit, tries the hold straight away while they're still on the page.
 */
export const finishTripCardUpdate = createServerFn({ method: 'POST' })
    .inputValidator((input: { bookingId: string; setupIntentId: string }) => input)
    .handler(async ({ data }) => {
        const { supabaseAdmin } = await assertBookingAccess(data.bookingId)
        const setupIntent = await getStripe().setupIntents.retrieve(data.setupIntentId)
        const deposit = await finishCardUpdate(supabaseAdmin, data.bookingId, setupIntent)
        return { deposit }
    })

// ── Owners: charging, refunding, the deposit ─────────────────────────────────

export const createTripCharge = createServerFn({ method: 'POST' })
    .inputValidator((input: { bookingId: string; category: string; description: string; amount: number }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        if (!isChargeCategory(data.category)) throw new Error('Choose what the charge is for.')
        const description = data.description.trim().slice(0, MAX_DESCRIPTION)
        if (!description) throw new Error('Describe the charge. The guest sees this on their receipt.')
        const amount = Math.round(Number(data.amount) * 100) / 100
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount above $0.')

        const attempt = await createAdjustmentCharge(getServiceRoleClient(), {
            bookingId: data.bookingId,
            category: data.category,
            description,
            amount,
            createdBy: user.id,
        })
        return { charge: attempt.charge, error: attempt.error }
    })

export const refundTripCharge = createServerFn({ method: 'POST' })
    .inputValidator((input: { chargeId: string; amount: number; reason: string }) => input)
    .handler(async ({ data }) => {
        const { supabaseAdmin, charge } = await chargeForAdmin(data.chargeId)
        const amount = Math.round(Number(data.amount) * 100) / 100
        return refundCharge(supabaseAdmin, charge, amount, (data.reason ?? '').trim().slice(0, MAX_REASON), { notify: true })
    })

export const captureTripDeposit = createServerFn({ method: 'POST' })
    .inputValidator((input: { chargeId: string; amount: number; reason: string }) => input)
    .handler(async ({ data }) => {
        const { supabaseAdmin, charge } = await chargeForAdmin(data.chargeId)
        const amount = Math.round(Number(data.amount) * 100) / 100
        return captureDeposit(supabaseAdmin, charge, amount, (data.reason ?? '').slice(0, MAX_REASON))
    })

export const releaseTripDeposit = createServerFn({ method: 'POST' })
    .inputValidator((chargeId: string) => chargeId)
    .handler(async ({ data: chargeId }) => {
        const { supabaseAdmin, charge } = await chargeForAdmin(chargeId)
        const released = await releaseDepositHold(supabaseAdmin, charge, { notifyGuest: true })
        return { released }
    })

export const setDepositKeepHolding = createServerFn({ method: 'POST' })
    .inputValidator((input: { chargeId: string; keep: boolean }) => input)
    .handler(async ({ data }) => {
        const { supabaseAdmin, charge } = await chargeForAdmin(data.chargeId)
        if (charge.kind !== 'deposit') throw new Error('Not a deposit hold')
        await supabaseAdmin.from('booking_charges').update({ keep_holding: data.keep }).eq('id', charge.id)
        return { keep: data.keep }
    })

/**
 * Waiving means the trip goes ahead without a hold — the lockbox code is given
 * out and the sweep stops trying. Un-waiving puts the trip back in the queue.
 */
export const setDepositWaived = createServerFn({ method: 'POST' })
    .inputValidator((input: { bookingId: string; waived: boolean }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        const supabaseAdmin = getServiceRoleClient()
        const { error } = await supabaseAdmin
            .from('bookings')
            .update(data.waived
                ? { deposit_waived_at: new Date().toISOString(), deposit_waived_by: user.id }
                : { deposit_waived_at: null, deposit_waived_by: null })
            .eq('id', data.bookingId)
        if (error) throw new Error(error.message)
        return { waived: data.waived }
    })

/**
 * Every taxed sale in a calendar year, for the owners' tax report
 * (/admin/business/tax-information). Checkouts from their frozen quotes,
 * later charges from the ledger — both carry the tax lines they were charged.
 */
export const getTaxSales = createServerFn({ method: 'GET' })
    .inputValidator((year: number) => year)
    .handler(async ({ data: year }): Promise<TaxedSale[]> => {
        await requireAdmin()
        const supabaseAdmin = getServiceRoleClient()
        // A day's slack either side, then filtered on the business-timezone month.
        const from = `${year - 1}-12-31T00:00:00Z`
        const to = `${year + 1}-01-02T00:00:00Z`
        const inYear = (month: string) => month.startsWith(`${year}-`)

        const [{ data: bookings }, { data: charges }] = await Promise.all([
            supabaseAdmin
                .from('bookings')
                .select('id, created_at, total_price, refunded_amount, price_quote, status')
                .in('status', ['confirmed', 'completed', 'canceled'])
                .gte('created_at', from)
                .lt('created_at', to),
            supabaseAdmin
                .from('booking_charges')
                .select('id, booking_id, created_at, settled_at, amount, tax_amount, amount_captured, amount_refunded, tax_lines, status, bookings!inner(price_quote)')
                .eq('status', 'succeeded')
                .gt('tax_amount', 0)
                .gte('created_at', from)
                .lt('created_at', to),
        ])

        const sales: TaxedSale[] = []
        for (const b of bookings ?? []) {
            const quote = storedQuote(b as any)
            // A canceled booking that was never paid has nothing to report; one
            // refunded in full nets to zero on its own.
            if (!quote || quote.taxTotal <= 0) continue
            const month = businessDateKey(b.created_at as string).slice(0, 7)
            if (!inYear(month)) continue
            sales.push({
                month,
                source: 'checkout',
                reference: b.id as string,
                jurisdiction: quote.taxJurisdiction,
                total: Number(b.total_price),
                refunded: Number(b.refunded_amount) || 0,
                taxLines: quote.taxLines,
            })
        }
        for (const c of charges ?? []) {
            const month = businessDateKey((c.settled_at ?? c.created_at) as string).slice(0, 7)
            if (!inYear(month)) continue
            sales.push({
                month,
                source: 'charge',
                reference: c.id as string,
                jurisdiction: taxContextFromQuote(storedQuote((c as any).bookings)).jurisdiction,
                total: Number(c.amount_captured),
                refunded: Number(c.amount_refunded) || 0,
                taxLines: Array.isArray(c.tax_lines) ? (c.tax_lines as TaxLine[]) : [],
            })
        }
        return sales
    })

/** "Try the hold now" — skips the retry wait, still never places one early. */
export const placeTripDeposit = createServerFn({ method: 'POST' })
    .inputValidator((bookingId: string) => bookingId)
    .handler(async ({ data: bookingId }) => {
        await requireAdmin()
        return ensureDepositHold(getServiceRoleClient(), bookingId, { force: true, initiatedBy: 'admin' })
    })