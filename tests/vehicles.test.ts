// The Vehicles admin pages (src/lib/vehicles.ts): listing and unlisting, the
// base price and per-mile fee, the lockbox code and VIN, and the change log.
// Also the two holes closed alongside them: an unlisted car could still be
// checked out, and a later price edit re-rated the mileage on trips already
// booked.

import { describe, expect, it } from 'vitest'
import { h, signIn } from './harness'
import { world, paidTrip, unpaidCheckout, GUEST, ADMIN, CAR } from './fixtures'
import { createCheckoutSession } from '../src/lib/db'
import {
    getVehicle,
    listVehicles,
    setVehicleListed,
    setVehicleLockboxCode,
    setVehiclePricing,
} from '../src/lib/vehicles'
import { buildReceipt } from '../src/lib/receipt'
import { UNLISTED_CAR_MESSAGE } from '../src/lib/availability'
import { validateDistanceFee, validatePricePerDay } from '../src/lib/fleet-view'

const NOW = '2026-10-10T17:00:00Z'
const START = '2026-10-20T15:00:00Z'
const END = '2026-10-23T15:00:00Z'
const OTHER_CAR = 7
const car = (id = CAR) => h.db.rows('cars').find(c => c.id === id)!

const checkoutInput = (carId = CAR) => ({
    carId: String(carId),
    startTime: START,
    endTime: END,
    startDateLocal: '2026-10-20',
    startTimeLocal: '10:00',
    endDateLocal: '2026-10-23',
    endTimeLocal: '10:00',
    totalPrice: 180,
    pickupLocation: 'Home base',
})

describe('only owners', () => {
    it('can read or change a vehicle', async () => {
        world(NOW)
        signIn(GUEST)
        const refused = [
            listVehicles(),
            getVehicle({ data: CAR }),
            setVehicleListed({ data: { carId: CAR, listed: false } }),
            setVehiclePricing({ data: { carId: CAR, pricePerDay: 1, distanceFee: 0.01 } }),
            setVehicleLockboxCode({ data: { carId: CAR, code: '1234' } }),
        ]
        for (const call of refused) await expect(call).rejects.toThrow('Not authorized')
        expect(car().is_available).toBe(true)
        expect(car().price_per_day).toBe(60)
        expect(h.db.rows('car_secrets')).toHaveLength(0)
        expect(h.db.rows('admin_changes')).toHaveLength(0)
    })
})

describe('unlisting', () => {
    it('closes open checkouts on that car only, and logs once however often it’s clicked', async () => {
        world(NOW)
        const mine = unpaidCheckout({ start: START, end: END, createdAt: '2026-10-10T16:50:00Z' })
        const otherIntent = h.stripe.seedIntent({ amount: 10000, status: 'requires_payment_method', metadata: { kind: 'trip' } })
        const other = h.db.insert('bookings', {
            car_id: OTHER_CAR, user_id: GUEST, start_time: START, end_time: END, total_price: 100,
            status: 'pending', stripe_payment_intent_id: otherIntent.id,
        })
        const confirmed = paidTrip({ start: '2026-11-01T15:00:00Z', end: '2026-11-03T15:00:00Z', bookedAt: '2026-10-01T15:00:00Z' })

        signIn(ADMIN)
        expect(await setVehicleListed({ data: { carId: CAR, listed: false } })).toEqual({ changed: true, releasedCheckouts: 1 })
        expect(await setVehicleListed({ data: { carId: CAR, listed: false } })).toEqual({ changed: false, releasedCheckouts: 0 })

        expect(car().is_available).toBe(false)
        expect(h.stripe.intents.get(mine.intent.id)!.status).toBe('canceled')
        expect(h.db.find('bookings', mine.booking.id)!.status).toBe('expired')
        // Another car's checkout and a confirmed trip are left alone.
        expect(h.stripe.intents.get(otherIntent.id)!.status).toBe('requires_payment_method')
        expect(h.db.find('bookings', other.id)!.status).toBe('pending')
        expect(h.db.find('bookings', confirmed.booking.id)!.status).toBe('confirmed')

        expect(h.db.rows('admin_changes').map(c => [c.field, c.old_value, c.new_value]))
            .toEqual([['is_available', 'Listed', 'Unlisted']])

        // Listing again is its own change.
        await setVehicleListed({ data: { carId: CAR, listed: true } })
        expect(car().is_available).toBe(true)
        expect(h.db.rows('admin_changes')).toHaveLength(2)
    })

    it('stops new checkouts: no PaymentIntent, no booking row', async () => {
        world(NOW)
        car().is_available = false
        signIn(GUEST)
        await expect(createCheckoutSession({ data: checkoutInput() })).rejects.toThrow(UNLISTED_CAR_MESSAGE)
        expect(h.stripe.intents.size).toBe(0)
        expect(h.db.rows('bookings')).toHaveLength(0)
    })

    it('stops resuming a checkout started before the car was unlisted, by either path', async () => {
        world(NOW)
        const started = unpaidCheckout({ start: START, end: END, createdAt: '2026-10-10T16:50:00Z' })
        car().is_available = false
        signIn(GUEST)

        // The same trip again (the dedup path).
        await expect(createCheckoutSession({ data: checkoutInput() })).rejects.toThrow(UNLISTED_CAR_MESSAGE)
        // By booking id, even if the request names a listed car.
        await expect(createCheckoutSession({ data: { ...checkoutInput(OTHER_CAR), bookingId: started.booking.id } }))
            .rejects.toThrow(UNLISTED_CAR_MESSAGE)
    })

    it('treats a car whose listing was never set as listed', async () => {
        world(NOW)
        car().is_available = null
        signIn(GUEST)
        await expect(createCheckoutSession({ data: checkoutInput() })).resolves.toMatchObject({ bookingId: expect.any(String) })
    })
})

describe('prices', () => {
    it('validates the base price and the per-mile fee', () => {
        expect(validatePricePerDay('65')).toEqual({ ok: true, value: 65 })
        expect(validatePricePerDay('65.5').ok).toBe(false)
        expect(validatePricePerDay(0).ok).toBe(false)
        expect(validatePricePerDay('').ok).toBe(false)
        expect(validatePricePerDay(60000).ok).toBe(false)
        expect(validateDistanceFee('0.35')).toEqual({ ok: true, value: 0.35 })
        // 0 isn't free miles: maxDistanceFee would quietly charge the default.
        expect(validateDistanceFee(0).ok).toBe(false)
        expect(validateDistanceFee('0.355').ok).toBe(false)
        expect(validateDistanceFee(35).ok).toBe(false)
        expect(validateDistanceFee('abc').ok).toBe(false)
    })

    it('saves both and logs only what changed', async () => {
        world(NOW)
        car().distance_fee = 0.35
        signIn(ADMIN)
        await setVehiclePricing({ data: { carId: CAR, pricePerDay: 65, distanceFee: 0.35 } })
        expect(car().price_per_day).toBe(65)
        expect(h.db.rows('admin_changes').map(c => [c.field, c.old_value, c.new_value])).toEqual([['price_per_day', '60', '65']])

        await expect(setVehiclePricing({ data: { carId: CAR, pricePerDay: 65, distanceFee: 0 } })).rejects.toThrow(/more than \$0/)
        expect(car().distance_fee).toBe(0.35)
    })

    it('never re-rates the mileage on a trip already booked', async () => {
        world(NOW)
        car().distance_fee = 0.40
        signIn(GUEST)
        const { bookingId } = await createCheckoutSession({ data: checkoutInput() })
        const booking = h.db.find('bookings', bookingId)!
        const before = buildReceipt(booking as any, car() as any).perMileFee
        expect(booking.price_quote.mileageRate).toBe(before)

        signIn(ADMIN)
        await setVehiclePricing({ data: { carId: CAR, pricePerDay: 90, distanceFee: 0.75 } })

        expect(buildReceipt(booking as any, car() as any).perMileFee).toBe(before)
    })

    it('still works out the rate for a trip booked before it was frozen', () => {
        world(NOW)
        car().distance_fee = 0.40
        const { booking } = paidTrip({ start: START, end: END, bookedAt: '2026-10-01T15:00:00Z' })
        // A 3-day trip takes the 5% tier, so its rate is 5% under the ceiling.
        expect(buildReceipt(booking as any, car() as any).perMileFee).toBe(0.38)
    })
})

describe('lockbox code', () => {
    it('keep the lockbox code out of the change log', async () => {
        world(NOW)
        signIn(ADMIN)
        await setVehicleLockboxCode({ data: { carId: CAR, code: ' 4821 ' } })
        await setVehicleLockboxCode({ data: { carId: CAR, code: '4821' } }) // unchanged: no log line
        await setVehicleLockboxCode({ data: { carId: CAR, code: '9075' } })
        await setVehicleLockboxCode({ data: { carId: CAR, code: '' } })

        expect(h.db.rows('car_secrets')).toHaveLength(1)
        expect(h.db.rows('car_secrets')[0].lockbox_code).toBeNull()
        const log = h.db.rows('admin_changes')
        expect(log.map(c => c.new_value)).toEqual(['set', 'changed', 'removed'])
        // Only the text columns: ids and timestamps are random and can contain these digits by chance.
        expect(JSON.stringify(log.map(c => [c.field, c.old_value, c.new_value]))).not.toMatch(/4821|9075/)
        expect((await getVehicle({ data: CAR })).lockboxCode).toBeNull()
    })
})

describe('what the pages show', () => {
    it('lists every car, unlisted too, with what it’s doing', async () => {
        world(NOW)
        car(OTHER_CAR).is_available = false
        paidTrip({ start: '2026-10-09T15:00:00Z', end: '2026-10-12T15:00:00Z', bookedAt: '2026-10-01T15:00:00Z' })
        h.db.insert('turo_bookings', { car_id: OTHER_CAR, start_time: '2026-10-01T15:00:00Z', end_time: '2026-10-03T15:00:00Z', gmail_message_id: 'g1', renter_name: 'Tess' })
        signIn(ADMIN)

        const rows = await listVehicles()
        const jeep = rows.find(r => r.id === CAR)!
        const camry = rows.find(r => r.id === OTHER_CAR)!
        expect(jeep.status.kind).toBe('on-trip')
        expect(camry.isAvailable).toBe(false)
        expect(camry.status).toMatchObject({ kind: 'last', source: 'turo' })
        // Bluefin trips only: the Turo trip shows as its last trip but isn't counted.
        expect(camry.tripCount).toBe(0)
    })

    it('a vehicle’s trips cover Bluefin and Turo, newest first, with what each collected', async () => {
        world(NOW)
        const old = paidTrip({ start: '2026-09-01T15:00:00Z', end: '2026-09-03T15:00:00Z', bookedAt: '2026-08-20T15:00:00Z', status: 'completed' })
        h.db.insert('turo_bookings', { car_id: CAR, start_time: '2026-09-20T15:00:00Z', end_time: '2026-09-22T15:00:00Z', gmail_message_id: 'g2', renter_name: 'Tess' })
        unpaidCheckout({ start: START, end: END, createdAt: '2026-10-10T16:50:00Z' }) // never a trip
        signIn(ADMIN)

        const v = await getVehicle({ data: CAR })
        expect(v.trips.map(t => t.source)).toEqual(['turo', 'bluefin'])
        expect(v.trips[1]).toMatchObject({ id: old.booking.id, collected: old.quote.total, phaseLabel: 'Completed' })
        expect(v.money.lifetimePaid).toBe(old.quote.total)
        expect(v.tripCount.total).toBe(1) // no Turo count entered yet: Bluefin only
        expect(v.vin).toBeNull()

        // Once the Turo count is entered, Turo trips ending after it are added.
        Object.assign(car(), { turo_trip_count: 40, turo_trip_count_at: '2026-09-15T00:00:00Z' })
        h.db.insert('car_secrets', { car_id: CAR, vin: '1M8GDM9AXKP042788' })
        const after = await getVehicle({ data: CAR })
        expect(after.tripCount).toMatchObject({ total: 42, turoBaseline: 40, turoSince: 1, bluefin: 1 })
        expect(after.vin).toBe('1M8GDM9AXKP042788')
        expect((await listVehicles()).find(r => r.id === CAR)!.tripCount).toBe(42)
    })
})
