// The Vehicles admin pages: the fleet list, one car's page, and the edits an
// owner can make there (listing, base price, per-mile fee, lockbox code).
//
// Server functions, each calling requireAdmin() first: route-level admin auth
// doesn't cover a server function called directly. Writes use the service-role
// client and add a line to the change log (admin_changes). Pure rules are in
// fleet-view.ts. Never re-export a .server.ts function from here: browser
// pages import this file.

import { createServerFn } from '@tanstack/react-start'
import { getServiceRoleClient, requireAdmin } from './access.server'
import { loadAdminChanges, recordAdminChange, type AdminChange } from './admin-changes.server'
import { releaseOpenCheckouts } from './open-checkouts.server'
import { summarizeCustomerMoney, type CustomerMoney, type MoneyCharge } from './crm-summary'
import { summarizeRatings } from './reviews'
import { tripPhase, TRIP_PHASE_LABEL } from './booking-status'
import { todayInBusinessTz } from './pricing'
import {
    bookedDaysAhead,
    normalizeLockboxCode,
    tripCount,
    type TripCount,
    validateDistanceFee,
    validatePricePerDay,
    vehicleTripStatus,
    type TripSpan,
} from './fleet-view'
import type { Car } from '../types'

// ── Types ────────────────────────────────────────────────────────────────────

/** The line a vehicle card shows: on a trip, next trip, last trip. */
export type VehicleStatusLine =
    | { kind: 'on-trip' | 'next' | 'last'; start: string; end: string; source: 'bluefin' | 'turo' }
    | { kind: 'none' }

export type VehicleListRow = {
    id: number
    make: string
    model: string
    year: number
    trim: string | null
    licensePlate: string | null
    isAvailable: boolean | null
    pricePerDay: number
    status: VehicleStatusLine
    /** Average of the car's reviews (Bluefin and imported Turo ones), null with none. */
    rating: number | null
    reviewCount: number
    /** Lifetime trips, Turo and Bluefin (fleet-view.ts#tripCount). Bluefin only until a Turo count is entered. */
    tripCount: number
    /** Booked days in the next 30 (fleet-view.ts#bookedDaysAhead). */
    bookedDays: number
}

export type VehicleTrip =
    | {
        source: 'bluefin'
        id: string
        start: string
        end: string
        status: string
        phaseLabel: string
        guestId: string
        guestName: string | null
        /** What the trip has brought in, net of refunds (the reservation page's "Total Earnings"). */
        collected: number
    }
    | {
        source: 'turo'
        id: string
        start: string
        end: string
        guestName: string | null
        turoTripId: string | null
    }

export type VehicleDetail = {
    car: Car
    lockboxCode: string | null
    /** Entered in Supabase (car_secrets.vin); the page only shows it, with a recall lookup. */
    vin: string | null
    status: VehicleStatusLine
    trips: VehicleTrip[]
    money: CustomerMoney
    rating: number | null
    reviewCount: number
    /** Lifetime trips with how they add up (fleet-view.ts#tripCount). */
    tripCount: TripCount
    bookedDays: number
    /** Dates from today on with a price typed on the calendar. */
    upcomingCalendarPrices: number
    changes: AdminChange[]
}

type Admin = ReturnType<typeof getServiceRoleClient>

// Statuses where the car really is (or was) out on the trip. Pending,
// expired and failed are checkouts that never became a trip; cancelled trips
// never held it.
const HOLDS_CAR = new Set(['confirmed', 'completed'])

type BookingRow = {
    id: string
    car_id: number
    user_id: string
    status: string
    start_time: string
    end_time: string
    total_price: number | string
    refunded_amount: number | string | null
}
type TuroRow = { id: string; car_id: number; start_time: string; end_time: string; renter_name: string | null; turo_trip_id: string | null }

function statusLine(bluefin: BookingRow[], turo: TuroRow[], now: Date): VehicleStatusLine {
    const spans: (TripSpan & { source: 'bluefin' | 'turo' })[] = [
        ...bluefin.filter(b => HOLDS_CAR.has(b.status)).map(b => ({ start_time: b.start_time, end_time: b.end_time, source: 'bluefin' as const })),
        ...turo.map(t => ({ start_time: t.start_time, end_time: t.end_time, source: 'turo' as const })),
    ]
    const s = vehicleTripStatus(spans, now)
    return s.kind === 'none' ? s : { kind: s.kind, start: s.trip.start_time, end: s.trip.end_time, source: s.trip.source }
}

/**
 * Turo (from the count an owner entered in Supabase on) plus Bluefin:
 * fleet-view.ts#tripCount.
 */
function tripsFor(car: Car, bluefin: BookingRow[], turo: TuroRow[], now: Date) {
    return tripCount({
        turoBaseline: car.turo_trip_count,
        turoBaselineAt: car.turo_trip_count_at,
        turoTrips: turo,
        bluefinCompleted: bluefin.filter(b => b.status === 'completed').length,
        now,
    })
}

function bookedDays(bluefin: BookingRow[], turo: TuroRow[]): number {
    return bookedDaysAhead(
        [...bluefin.filter(b => b.status === 'confirmed'), ...turo],
        todayInBusinessTz(),
    )
}

async function readCar(admin: Admin, carId: number): Promise<Car> {
    if (!Number.isInteger(carId) || carId <= 0) throw new Error('Vehicle not found')
    const { data, error } = await admin.from('cars').select('*').eq('id', carId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Vehicle not found')
    return data as Car
}

// ── The list ─────────────────────────────────────────────────────────────────

export const listVehicles = createServerFn({ method: 'GET' }).handler(async (): Promise<VehicleListRow[]> => {
    await requireAdmin()
    const admin = getServiceRoleClient()
    const now = new Date()

    const [carsRes, bookingsRes, turoRes, reviewsRes] = await Promise.all([
        admin.from('cars').select('*').order('make').order('model').order('year'),
        admin.from('bookings').select('id, car_id, user_id, status, start_time, end_time, total_price, refunded_amount')
            .in('status', ['confirmed', 'completed']),
        admin.from('turo_bookings').select('id, car_id, start_time, end_time, renter_name, turo_trip_id'),
        admin.from('reviews').select('car_id, rating').is('removed_at', null),
    ])
    for (const res of [carsRes, bookingsRes, turoRes, reviewsRes]) if (res.error) throw new Error(res.error.message)

    const bookings = (bookingsRes.data ?? []) as BookingRow[]
    const turo = (turoRes.data ?? []) as TuroRow[]
    const reviews = (reviewsRes.data ?? []) as { car_id: number; rating: number }[]

    return ((carsRes.data ?? []) as Car[]).map(car => {
        const own = bookings.filter(b => b.car_id === car.id)
        const ownTuro = turo.filter(t => t.car_id === car.id)
        const ratings = summarizeRatings(reviews.filter(r => r.car_id === car.id).map(r => r.rating))
        return {
            id: car.id,
            make: car.make,
            model: car.model,
            year: car.year,
            trim: car.trim,
            licensePlate: car.license_plate,
            isAvailable: car.is_available,
            pricePerDay: Number(car.price_per_day),
            status: statusLine(own, ownTuro, now),
            rating: ratings.average,
            reviewCount: ratings.count,
            tripCount: tripsFor(car, own, ownTuro, now).total,
            bookedDays: bookedDays(own, ownTuro),
        }
    })
})

// ── One car ──────────────────────────────────────────────────────────────────

export const getVehicle = createServerFn({ method: 'GET' })
    .inputValidator((carId: number) => Number(carId))
    .handler(async ({ data: carId }): Promise<VehicleDetail> => {
        await requireAdmin()
        const admin = getServiceRoleClient()
        const now = new Date()
        const car = await readCar(admin, carId)

        const [secretsRes, bookingsRes, turoRes, reviewsRes, overridesRes, changes] = await Promise.all([
            admin.from('car_secrets').select('lockbox_code, vin').eq('car_id', carId).maybeSingle(),
            // Every trip, not just paid ones: a checkout that never paid isn't
            // a trip, so pending, expired and failed rows are left out.
            admin.from('bookings')
                .select('id, car_id, user_id, status, start_time, end_time, total_price, refunded_amount, profiles(full_name, email)')
                .eq('car_id', carId)
                .in('status', ['confirmed', 'completed', 'canceled'])
                .order('start_time', { ascending: false }),
            admin.from('turo_bookings').select('id, car_id, start_time, end_time, renter_name, turo_trip_id')
                .eq('car_id', carId)
                .order('start_time', { ascending: false }),
            admin.from('reviews').select('rating').eq('car_id', carId).is('removed_at', null),
            admin.from('car_price_overrides').select('date', { count: 'exact', head: true })
                .eq('car_id', carId).gte('date', todayInBusinessTz()),
            loadAdminChanges(admin, carId),
        ])
        for (const res of [secretsRes, bookingsRes, turoRes, reviewsRes, overridesRes]) if (res.error) throw new Error(res.error.message)

        // The untyped service-role client guesses a to-many embed; bookings.user_id
        // is a single FK, so PostgREST returns one profile.
        const bookings = (bookingsRes.data ?? []) as unknown as (BookingRow & { profiles: { full_name: string | null; email: string | null } | null })[]
        const turo = (turoRes.data ?? []) as TuroRow[]
        const ids = bookings.map(b => b.id)
        const { data: charges, error: chargesErr } = ids.length
            ? await admin.from('booking_charges')
                .select('booking_id, kind, status, amount, tax_amount, amount_captured, amount_refunded')
                .in('booking_id', ids)
            : { data: [], error: null }
        if (chargesErr) throw new Error(chargesErr.message)
        const allCharges = (charges ?? []) as MoneyCharge[]

        const trips: VehicleTrip[] = [
            ...bookings.map((b): VehicleTrip => ({
                source: 'bluefin',
                id: b.id,
                start: b.start_time,
                end: b.end_time,
                status: b.status,
                phaseLabel: TRIP_PHASE_LABEL[tripPhase(b, now)],
                guestId: b.user_id,
                guestName: b.profiles?.full_name || b.profiles?.email || null,
                collected: summarizeCustomerMoney([b], allCharges.filter(c => c.booking_id === b.id)).lifetimePaid,
            })),
            ...turo.map((t): VehicleTrip => ({
                source: 'turo',
                id: t.id,
                start: t.start_time,
                end: t.end_time,
                guestName: t.renter_name,
                turoTripId: t.turo_trip_id,
            })),
        ].sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())

        const ratings = summarizeRatings(((reviewsRes.data ?? []) as { rating: number }[]).map(r => r.rating))
        return {
            car,
            lockboxCode: secretsRes.data?.lockbox_code ?? null,
            vin: secretsRes.data?.vin?.trim() || null,
            status: statusLine(bookings, turo, now),
            trips,
            money: summarizeCustomerMoney(bookings, allCharges),
            rating: ratings.average,
            reviewCount: ratings.count,
            tripCount: tripsFor(car, bookings, turo, now),
            bookedDays: bookedDays(bookings, turo),
            upcomingCalendarPrices: overridesRes.count ?? 0,
            changes,
        }
    })

// ── Edits ────────────────────────────────────────────────────────────────────

/**
 * Lists or unlists a car. Unlisting stops new bookings (assertCarIsListed in
 * createCheckoutSession) and closes every checkout on the car that could still
 * be paid, because the webhook revives an expired checkout on a late payment.
 * Confirmed trips are never touched; the owners deal with each one.
 *
 * Conditional on the current value, so a double click or a second tab changes
 * (and logs) it once.
 */
export const setVehicleListed = createServerFn({ method: 'POST' })
    .inputValidator((input: { carId: number; listed: boolean }) => ({ carId: Number(input.carId), listed: Boolean(input.listed) }))
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        const admin = getServiceRoleClient()
        await readCar(admin, data.carId)

        // null has always meant listed.
        let claim = admin.from('cars').update({ is_available: data.listed, updated_at: new Date().toISOString() }).eq('id', data.carId)
        claim = data.listed ? claim.eq('is_available', false) : claim.or('is_available.is.null,is_available.eq.true')
        const { data: changed, error } = await claim.select('id')
        if (error) throw new Error(error.message)
        if (!changed?.length) return { changed: false, releasedCheckouts: 0 }

        await recordAdminChange(admin, {
            carId: data.carId,
            field: 'is_available',
            oldValue: data.listed ? 'Unlisted' : 'Listed',
            newValue: data.listed ? 'Listed' : 'Unlisted',
            changedBy: user.id,
        })

        const releasedCheckouts = data.listed ? 0 : await releaseOpenCheckouts(admin, { carId: data.carId }, 'Car unlisted')
        return { changed: true, releasedCheckouts }
    })

/**
 * The base daily price and the per-mile fee. New quotes use them at once.
 * Existing trips keep what they were charged (price_quote) and the per-mile
 * rate they were shown (price_quote.mileageRate); extensions are priced at
 * current prices, as they always have been.
 */
export const setVehiclePricing = createServerFn({ method: 'POST' })
    .inputValidator((input: { carId: number; pricePerDay: number; distanceFee: number }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        const price = validatePricePerDay(data.pricePerDay)
        if (!price.ok) throw new Error(price.error)
        const fee = validateDistanceFee(data.distanceFee)
        if (!fee.ok) throw new Error(fee.error)

        const admin = getServiceRoleClient()
        const carId = Number(data.carId)
        const car = await readCar(admin, carId)

        const { error } = await admin
            .from('cars')
            .update({ price_per_day: price.value, distance_fee: fee.value, updated_at: new Date().toISOString() })
            .eq('id', carId)
        if (error) throw new Error(error.message)

        if (Number(car.price_per_day) !== price.value) {
            await recordAdminChange(admin, { carId, field: 'price_per_day', oldValue: Number(car.price_per_day), newValue: price.value, changedBy: user.id })
        }
        const oldFee = car.distance_fee === null ? null : Number(car.distance_fee)
        if (oldFee !== fee.value) {
            await recordAdminChange(admin, { carId, field: 'distance_fee', oldValue: oldFee, newValue: fee.value, changedBy: user.id })
        }
        return { ok: true }
    })

/**
 * The lockbox code guests get through guestLockboxCode. The change log records
 * that the code changed, never the code. Codes already emailed don't change:
 * the trip page reads this fresh, the emails don't.
 */
export const setVehicleLockboxCode = createServerFn({ method: 'POST' })
    .inputValidator((input: { carId: number; code: string | null }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        const code = normalizeLockboxCode(data.code)
        if (!code.ok) throw new Error(code.error)

        const admin = getServiceRoleClient()
        const carId = Number(data.carId)
        await readCar(admin, carId)
        const { data: before } = await admin.from('car_secrets').select('lockbox_code').eq('car_id', carId).maybeSingle()
        const old = (before?.lockbox_code as string | null | undefined) ?? null
        if (old === code.value) return { ok: true }

        const { error } = await admin
            .from('car_secrets')
            .upsert({ car_id: carId, lockbox_code: code.value, updated_at: new Date().toISOString() }, { onConflict: 'car_id' })
        if (error) throw new Error(error.message)

        await recordAdminChange(admin, {
            carId,
            field: 'lockbox_code',
            oldValue: old ? 'set' : null,
            newValue: code.value ? (old ? 'changed' : 'set') : 'removed',
            changedBy: user.id,
        })
        return { ok: true }
    })
