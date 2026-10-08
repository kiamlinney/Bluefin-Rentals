// Ready-made bookings and charges, written into the fake database and fake
// Stripe together so the two always agree (a paid trip has a succeeded intent,
// a deposit hold has an uncaptured one, and so on).

import { h, reset, ADMIN_EMAIL } from './harness'
import { calculateTripPrice } from '../src/lib/pricing'
import { businessDateKey, businessWallClockTime } from '../src/lib/dates'
import type { BookingRate } from '../src/lib/booking-rate'
import type { Row } from './fakes/supabase'

export const GUEST = '00000000-0000-4000-8000-00000000000a'
export const OTHER_GUEST = '00000000-0000-4000-8000-00000000000b'
export const ADMIN = '00000000-0000-4000-8000-0000000000ad'
export const GUEST_EMAIL = 'gina@test.bluefin'
export const CAR = 5

const cents = (dollars: number) => Math.round(dollars * 100)

/** A fresh world with one car, a guest, another guest and an owner. */
export function world(now: string) {
    reset(now, {
        cars: [
            { id: CAR, make: 'Jeep', model: 'Cherokee', year: 2018, trim: null, image_url: null, price_per_day: 60, is_available: true },
            { id: 7, make: 'Toyota', model: 'Camry', year: 2020, trim: null, image_url: null, price_per_day: 55, is_available: true },
        ],
        profiles: [
            { id: GUEST, full_name: 'Gina Guest', email: GUEST_EMAIL, phone: null, num_trips: 1, is_admin: false, stripe_customer_id: 'cus_test' },
            { id: OTHER_GUEST, full_name: 'Otto Other', email: 'otto@test.bluefin', phone: null, num_trips: 0, is_admin: false, stripe_customer_id: 'cus_other' },
            { id: ADMIN, full_name: 'Olive Owner', email: ADMIN_EMAIL, phone: null, num_trips: 0, is_admin: true, stripe_customer_id: null },
        ],
    })
}

/** The quote checkout would have stored for this trip. */
export function quoteFor(start: string, end: string, rate: BookingRate, extraIds: string[] = []) {
    return calculateTripPrice({
        startDate: businessDateKey(start),
        startTime: businessWallClockTime(start),
        endDate: businessDateKey(end),
        endTime: businessWallClockTime(end),
        basePricePerDay: 60,
        bookingRate: rate,
        extraIds,
        today: businessDateKey(new Date(new Date(start).getTime() - 30 * 24 * 3600 * 1000)),
    })
}

/** A paid, confirmed trip (or any status) with its succeeded checkout payment. */
export function paidTrip(o: {
    start: string
    end: string
    bookedAt: string
    rate?: BookingRate
    status?: string
    userId?: string
    carId?: number
    extraIds?: string[]
}) {
    const rate = o.rate ?? 'non-refundable'
    const quote = quoteFor(o.start, o.end, rate, o.extraIds)
    const intent = h.stripe.seedIntent({ amount: cents(quote.total), status: 'succeeded', metadata: { kind: 'trip' } })
    const booking = h.db.insert('bookings', {
        car_id: o.carId ?? CAR,
        user_id: o.userId ?? GUEST,
        start_time: o.start,
        end_time: o.end,
        created_at: o.bookedAt,
        total_price: quote.total,
        status: o.status ?? 'confirmed',
        booking_rate: rate,
        price_quote: { version: 2, ...quote },
        stripe_payment_intent_id: intent.id,
        payment_method_id: 'pm_ok',
        admin_notified_at: o.bookedAt,
        guest_notified_at: o.bookedAt,
    })
    return { booking, intent, quote }
}

/** A checkout that was started but not paid: a pending row and its open intent. */
export function unpaidCheckout(o: { start: string; end: string; createdAt: string; status?: string; userId?: string }) {
    const quote = quoteFor(o.start, o.end, 'non-refundable')
    const intent = h.stripe.seedIntent({ amount: cents(quote.total), status: 'requires_payment_method', metadata: { kind: 'trip' } })
    const booking = h.db.insert('bookings', {
        car_id: CAR,
        user_id: o.userId ?? GUEST,
        start_time: o.start,
        end_time: o.end,
        created_at: o.createdAt,
        total_price: quote.total,
        status: o.status ?? 'pending',
        price_quote: { version: 2, ...quote },
        stripe_payment_intent_id: intent.id,
    })
    return { booking, intent, quote }
}

/** Stripe "pays" an open intent, the way the guest's card would. */
export function pay(intentId: string) {
    const intent = h.stripe.intents.get(intentId)!
    intent.status = 'succeeded'
    intent.amount_received = intent.amount
    intent.latest_charge = { id: `ch_for_${intentId}`, amount_refunded: 0, payment_method_details: { card: { brand: 'visa', last4: '4242' } } }
}

function ledgerRow(booking: Row, fields: Row): Row {
    return h.db.insert('booking_charges', {
        booking_id: booking.id,
        description: fields.kind,
        initiated_by: 'guest',
        ...fields,
    })
}

/** A paid later charge (extension, extra, or an owner's adjustment). */
export function paidCharge(booking: Row, kind: 'extension' | 'extra' | 'adjustment', amount: number, tax = 0) {
    const intent = h.stripe.seedIntent({ amount: cents(amount + tax), status: 'succeeded', metadata: { kind, bookingId: booking.id } })
    const charge = ledgerRow(booking, {
        kind, amount, tax_amount: tax, amount_captured: amount + tax, status: 'succeeded',
        stripe_payment_intent_id: intent.id, category: kind === 'adjustment' ? 'damage' : null,
    })
    intent.metadata.chargeId = charge.id
    return { charge, intent }
}

/** A paid extension, with its booking_extensions row. */
export function paidExtension(booking: Row, amount: number, refundablePremium = 0) {
    const { charge, intent } = paidCharge(booking, 'extension', amount)
    const extension = h.db.insert('booking_extensions', {
        booking_id: booking.id,
        from_end_time: booking.end_time,
        to_end_time: new Date(new Date(booking.end_time).getTime() + 24 * 3600 * 1000).toISOString(),
        mode: 'instant',
        status: 'confirmed',
        quote: { refundableSurchargeAmount: refundablePremium, total: amount },
        amount,
        charge_id: charge.id,
    })
    return { charge, intent, extension }
}

/** A $1,500 deposit hold on the card. */
export function depositHold(booking: Row) {
    const intent = h.stripe.seedIntent({ amount: 150000, status: 'requires_capture', capture_method: 'manual', metadata: { kind: 'deposit', bookingId: booking.id } })
    const charge = ledgerRow(booking, { kind: 'deposit', amount: 1500, status: 'authorized', stripe_payment_intent_id: intent.id, initiated_by: 'system' })
    intent.metadata.chargeId = charge.id
    return { charge, intent }
}

/** A deposit hold the guest's bank still wants them to authenticate. */
export function depositAwaiting3ds(booking: Row) {
    const intent = h.stripe.seedIntent({ amount: 150000, status: 'requires_action', capture_method: 'manual', metadata: { kind: 'deposit', bookingId: booking.id } })
    const charge = ledgerRow(booking, { kind: 'deposit', amount: 1500, status: 'requires_payment', stripe_payment_intent_id: intent.id, initiated_by: 'guest' })
    intent.metadata.chargeId = charge.id
    return { charge, intent }
}

/** An extra the guest asked for after booking, its card hold not yet answered. */
export function extraRequest(booking: Row, amount = 25) {
    const intent = h.stripe.seedIntent({ amount: cents(amount), status: 'requires_capture', capture_method: 'manual', metadata: { kind: 'extra', bookingId: booking.id } })
    const charge = ledgerRow(booking, { kind: 'extra', amount, status: 'authorized', stripe_payment_intent_id: intent.id, category: 'child-seat' })
    intent.metadata.chargeId = charge.id
    const extra = h.db.insert('booking_extras', {
        booking_id: booking.id, extra_id: 'child-seat', name: 'Child seat', billing: 'per-trip',
        unit_price: amount, quantity: 1, amount, source: 'post-booking', status: 'requested', charged: false, charge_id: charge.id,
    })
    return { charge, intent, extra }
}

/** A last-hour extension request: the card held, waiting on an owner. */
export function extensionRequest(booking: Row, amount = 80) {
    const intent = h.stripe.seedIntent({ amount: cents(amount), status: 'requires_capture', capture_method: 'manual', metadata: { kind: 'extension', bookingId: booking.id } })
    const charge = ledgerRow(booking, { kind: 'extension', amount, status: 'authorized', stripe_payment_intent_id: intent.id })
    intent.metadata.chargeId = charge.id
    const extension = h.db.insert('booking_extensions', {
        booking_id: booking.id,
        from_end_time: booking.end_time,
        to_end_time: new Date(new Date(booking.end_time).getTime() + 24 * 3600 * 1000).toISOString(),
        mode: 'request',
        status: 'requested',
        quote: { refundableSurchargeAmount: 0, total: amount },
        amount,
        charge_id: charge.id,
    })
    return { charge, intent, extension }
}

export const chargeRow = (id: string) => h.db.find('booking_charges', id)!
export const bookingRow = (id: string) => h.db.find('bookings', id)!
