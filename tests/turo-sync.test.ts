// The Turo sync end to end: real runTuroSync, assignTuroTripCar and the alert
// emails, against FakeGmail and the fake database.
//
// The cases are the ones found in the live inbox on 2026-10-12: a change
// request applied before it was answered (and its confirmation never
// fetched), a Turo-initiated cancellation stored as a booking, a vehicle swap
// nobody was told to act on, and Turo trips overlapping Bluefin trips.

import { describe, expect, it, vi } from 'vitest'
import { h, signIn, at, ADMIN_EMAIL } from './harness'
import { world, paidTrip, ADMIN, GUEST, CAR } from './fixtures'
import { runTuroSync } from '../src/lib/turo-sync.server'
import { assignTuroTripCar, getTuroSwapOptions, previewTuroSwap, syncTuroBookings } from '../src/lib/db'
import { isTuroSwapPending, nextSwapToPrompt, turoSwapKey } from '../src/lib/turo-swap'
import { booked, changeConfirmed, changeRequested, swapAccepted, tripChanged, turoCanceled } from './turo-emails'

const NOW = '2026-10-12T17:00:00Z'
const CAMRY = 7

// 10/20 11:00 am to 10/22 5:00 pm, business time (CDT).
const TRIP = { trip: '62239424', start: '10/20/26 11:00 am', end: '10/22/26 5:00 pm' }
const START = '2026-10-20T16:00:00.000Z'
const END = '2026-10-22T22:00:00.000Z'

const sync = () => runTuroSync(h.db as any, 1)
const row = (trip = TRIP.trip) => h.db.rows('turo_bookings').find(r => r.turo_trip_id === trip)
const alerts = (prefix: 'IMPORTANT' | 'URGENT') => h.emails.filter(e => e.subject.startsWith(`${prefix}:`))

describe('trips, changes and cancellations', () => {
    it('stores a booking on the matching car, at business time', async () => {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))

        const result = await sync()

        expect(result).toMatchObject({ synced: 1, errors: [] })
        expect(row()).toMatchObject({ car_id: CAR, start_time: START, end_time: END, renter_name: 'Aliyah', gmail_message_id: 'm1' })
    })

    it('blocks both versions of a change request until it is confirmed, then the confirmed one', async () => {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        await sync()

        // The renter asks to end a day early. Until we answer, the car stays
        // blocked to the original end: declining must not leave it double-booked.
        h.gmail.add(changeRequested({ id: 'm2', sentAt: '2026-10-12T13:00:00Z', ...TRIP, end: '10/21/26 5:00 pm', oldEnd: '10/22/26 5:00 pm' }))
        await sync()
        expect(row()).toMatchObject({ start_time: START, end_time: END })

        // Our confirmation carries the final dates.
        h.gmail.add(changeConfirmed({ id: 'm3', sentAt: '2026-10-12T13:05:00Z', ...TRIP, end: '10/21/26 5:00 pm' }))
        await sync()
        expect(row()).toMatchObject({ start_time: START, end_time: '2026-10-21T22:00:00.000Z', gmail_message_id: 'm3' })
    })

    it('blocks a requested extension straight away', async () => {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        h.gmail.add(changeRequested({ id: 'm2', sentAt: '2026-10-12T13:00:00Z', ...TRIP, end: '10/24/26 5:00 pm', oldEnd: '10/22/26 5:00 pm' }))
        await sync()
        expect(row()).toMatchObject({ start_time: START, end_time: '2026-10-24T22:00:00.000Z' })
    })

    it('applies a catch-up in the order Turo sent the emails, not the order Gmail lists them', async () => {
        world(NOW)
        // Gmail lists newest first: confirmation, request, booking.
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        h.gmail.add(changeRequested({ id: 'm2', sentAt: '2026-10-12T13:00:00Z', ...TRIP, end: '10/21/26 5:00 pm', oldEnd: '10/22/26 5:00 pm' }))
        h.gmail.add(changeConfirmed({ id: 'm3', sentAt: '2026-10-12T13:05:00Z', ...TRIP, end: '10/21/26 5:00 pm' }))

        await sync()
        expect(row()).toMatchObject({ end_time: '2026-10-21T22:00:00.000Z', gmail_message_id: 'm3' })

        // And running it again changes nothing.
        await sync()
        expect(row()).toMatchObject({ end_time: '2026-10-21T22:00:00.000Z', gmail_message_id: 'm3' })
        expect(h.db.rows('turo_bookings')).toHaveLength(1)
    })

    it('lands an unanswered request on its booking in a catch-up, rather than replacing it', async () => {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        h.gmail.add(changeRequested({ id: 'm2', sentAt: '2026-10-12T13:00:00Z', ...TRIP, end: '10/21/26 5:00 pm', oldEnd: '10/22/26 5:00 pm' }))

        await sync()

        expect(row()).toMatchObject({ start_time: START, end_time: END })
    })

    it('removes a trip Turo itself cancelled, instead of storing the cancellation as a booking', async () => {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        await sync()
        expect(row()).toBeDefined()

        h.gmail.add(turoCanceled({ id: 'm2', sentAt: '2026-10-12T14:00:00Z', ...TRIP }))
        const result = await sync()

        expect(result.canceled).toBe(1)
        expect(h.db.rows('turo_bookings')).toHaveLength(0)
    })

    it('never stores a cancellation for a trip it had not seen', async () => {
        world(NOW)
        h.gmail.add(turoCanceled({ id: 'm2', sentAt: '2026-10-12T14:00:00Z', ...TRIP }))
        await sync()
        expect(h.db.rows('turo_bookings')).toHaveLength(0)
    })

    it('reports an email it does not recognise and stores nothing', async () => {
        world(NOW)
        h.gmail.add({ ...booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }), notification: 'SomethingNew', subject: 'Aliyah did something to their trip with your Jeep Cherokee' })

        const result = await sync()

        expect(h.db.rows('turo_bookings')).toHaveLength(0)
        expect(result.errors).toEqual([expect.stringContaining('unrecognised Turo email (SomethingNew)')])
    })

    it('runs the admin catch-up over 30 days, for admins only', async () => {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))

        signIn(GUEST)
        await expect(syncTuroBookings()).rejects.toThrow('Not authorized')

        signIn(ADMIN)
        await syncTuroBookings()
        expect(h.gmail.queries.at(-1)).toContain('newer_than:30d')
        expect(row()).toBeDefined()
    })
})

describe('vehicle swaps', () => {
    async function bookedAndSwapped() {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        await sync()
        h.gmail.add(swapAccepted({ id: 's1', sentAt: '2026-10-12T15:00:00Z', trip: TRIP.trip }))
        return sync()
    }

    it('flags the trip, keeps the original car blocked, and sends the owners one IMPORTANT email', async () => {
        const result = await bookedAndSwapped()

        expect(result.swapsFlagged).toBe(1)
        expect(row()).toMatchObject({ car_id: CAR, swap_accepted_at: '2026-10-12T15:00:00.000Z' })
        expect(isTuroSwapPending(row() as any)).toBe(true)

        const [alert, ...rest] = alerts('IMPORTANT')
        expect(rest).toHaveLength(0)
        expect(alert).toMatchObject({ to: ADMIN_EMAIL, priority: 'high' })
        expect(alert!.subject).toContain(TRIP.trip)
        expect(alert!.text).toContain('Jeep Cherokee 2018')
    })

    it('does not email again when later runs read the same acceptance', async () => {
        await bookedAndSwapped()
        await sync()
        await sync()
        expect(alerts('IMPORTANT')).toHaveLength(1)
    })

    it('is settled when an owner picks the car, and an old acceptance cannot re-open it', async () => {
        await bookedAndSwapped()
        signIn(ADMIN)

        const { options } = await getTuroSwapOptions({ data: row()!.id })
        expect(options.map(o => o.id)).toEqual([CAR, CAMRY])
        expect(options[0]!.isCurrent).toBe(true)

        at('2026-10-12T17:30:00Z')
        await assignTuroTripCar({ data: { turoBookingId: row()!.id, carId: CAMRY } })
        expect(row()!.car_id).toBe(CAMRY)
        expect(isTuroSwapPending(row() as any)).toBe(false)

        await sync()
        expect(isTuroSwapPending(row() as any)).toBe(false)
        expect(alerts('IMPORTANT')).toHaveLength(1)
    })

    it('only lets an admin pick the car', async () => {
        await bookedAndSwapped()
        signIn(GUEST)
        await expect(assignTuroTripCar({ data: { turoBookingId: row()!.id, carId: CAMRY } })).rejects.toThrow('Not authorized')
        await expect(getTuroSwapOptions({ data: row()!.id })).rejects.toThrow('Not authorized')
        expect(row()!.car_id).toBe(CAR)
    })

    it('is settled by a later Turo email that names the new car', async () => {
        await bookedAndSwapped()
        h.gmail.add(tripChanged({ id: 'm2', sentAt: '2026-10-12T16:00:00Z', ...TRIP, car: 'Toyota Camry 2020' }))
        await sync()

        expect(row()!.car_id).toBe(CAMRY)
        expect(isTuroSwapPending(row() as any)).toBe(false)
    })

    it('keeps the car when an email sent before the swap is read after it', async () => {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        h.gmail.add(swapAccepted({ id: 's1', sentAt: '2026-10-12T15:00:00Z', trip: TRIP.trip }))
        await sync()

        // A change email from before the swap (still naming the Camry) turns up late.
        h.gmail.add(tripChanged({ id: 'm2', sentAt: '2026-10-12T14:00:00Z', ...TRIP, end: '10/23/26 5:00 pm', car: 'Toyota Camry 2020' }))
        await sync()

        expect(row()).toMatchObject({ car_id: CAR, end_time: '2026-10-23T22:00:00.000Z' })
        expect(isTuroSwapPending(row() as any)).toBe(true)
    })

    it('ignores a swap on a trip that is already over', async () => {
        world(NOW)
        h.db.insert('turo_bookings', {
            car_id: CAR, turo_trip_id: TRIP.trip, gmail_message_id: 'old',
            start_time: '2026-09-20T16:00:00Z', end_time: '2026-09-24T16:00:00Z', email_sent_at: '2026-09-18T12:00:00Z',
        })
        h.gmail.add(swapAccepted({ id: 's1', sentAt: '2026-09-21T15:00:00Z', trip: TRIP.trip }))
        await sync()

        expect(row()!.swap_accepted_at).toBeNull()
        expect(alerts('IMPORTANT')).toHaveLength(0)
    })

    it('reads the reservation from the body when the header is missing', async () => {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        h.gmail.add(swapAccepted({ id: 's1', sentAt: '2026-10-12T15:00:00Z', trip: TRIP.trip, withHeader: false }))
        await sync()
        expect(isTuroSwapPending(row() as any)).toBe(true)
    })

    it('tries again on the next run if the email did not send', async () => {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        await sync()
        h.gmail.add(swapAccepted({ id: 's1', sentAt: '2026-10-12T15:00:00Z', trip: TRIP.trip }))

        h.failNextEmails = 1
        const failed = await sync()
        expect(failed.errors).toEqual([expect.stringContaining('did not send')])
        expect(row()!.swap_accepted_at).toBeNull()
        expect(alerts('IMPORTANT')).toHaveLength(0)

        await sync()
        expect(alerts('IMPORTANT')).toHaveLength(1)
        expect(isTuroSwapPending(row() as any)).toBe(true)
    })
})

describe('which swap the dialog opens by itself', () => {
    const trip = (id: string, accepted: string | null, confirmed: string | null = null) =>
        ({ id, swap_accepted_at: accepted, swap_car_confirmed_at: confirmed })

    it('opens the first pending swap, skipping settled ones', () => {
        const trips = [trip('a', null), trip('b', '2026-10-12T07:00:00Z', '2026-10-12T07:01:00Z'), trip('c', '2026-10-12T07:00:00Z')]
        expect(nextSwapToPrompt(trips, new Set())?.id).toBe('c')
    })

    it('does not reopen a swap just saved while the page still holds its old, pending copy', () => {
        const stale = trip('c', '2026-10-12T07:00:00Z')
        expect(nextSwapToPrompt([stale], new Set([turoSwapKey(stale)]))).toBeNull()
    })

    it('still opens for a newer swap on the same trip', () => {
        const settled = new Set([turoSwapKey(trip('c', '2026-10-12T07:00:00Z'))])
        expect(nextSwapToPrompt([trip('c', '2026-10-20T07:00:00Z')], settled)?.id).toBe('c')
    })
})

describe('previewing a swap (dev server only)', () => {
    async function bookedTrip() {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        await sync()
        return row()!
    }

    it('does what a real acceptance email does: flags the trip and sends the one IMPORTANT email', async () => {
        const trip = await bookedTrip()
        signIn(ADMIN)

        expect(await previewTuroSwap({ data: trip.id })).toEqual({ result: 'flagged' })
        expect(isTuroSwapPending(row() as any)).toBe(true)
        expect(row()!.car_id).toBe(CAR)
        expect(alerts('IMPORTANT')).toHaveLength(1)

        // Undo: pick the car it is already on.
        await assignTuroTripCar({ data: { turoBookingId: trip.id, carId: CAR } })
        expect(isTuroSwapPending(row() as any)).toBe(false)
        expect(row()!.car_id).toBe(CAR)
    })

    it('is admin-only', async () => {
        const trip = await bookedTrip()
        signIn(GUEST)
        await expect(previewTuroSwap({ data: trip.id })).rejects.toThrow('Not authorized')
        expect(row()!.swap_accepted_at).toBeNull()
    })

    it('refuses to run in a production build', async () => {
        const trip = await bookedTrip()
        signIn(ADMIN)
        vi.stubEnv('DEV', false)
        try {
            await expect(previewTuroSwap({ data: trip.id })).rejects.toThrow('only run on the dev server')
        } finally {
            vi.unstubAllEnvs()
        }
        expect(row()!.swap_accepted_at).toBeNull()
        expect(alerts('IMPORTANT')).toHaveLength(0)
    })
})

describe('overlap alerts', () => {
    function bluefinTripOnTheJeep() {
        return paidTrip({ start: '2026-10-21T15:00:00Z', end: '2026-10-25T15:00:00Z', bookedAt: '2026-10-01T12:00:00Z' }).booking
    }

    it('emails the owners once, URGENT, when a Turo trip lands on a Bluefin trip', async () => {
        world(NOW)
        const booking = bluefinTripOnTheJeep()
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))

        const result = await sync()

        expect(result.overlapsAlerted).toBe(1)
        const [alert] = alerts('URGENT')
        expect(alert).toMatchObject({ to: ADMIN_EMAIL, priority: 'high' })
        expect(alert!.text).toContain(`Bluefin #${booking.id.slice(0, 8).toUpperCase()}`)
        expect(alert!.text).toContain(`Turo #${TRIP.trip}`)

        await sync()
        await sync()
        expect(alerts('URGENT')).toHaveLength(1)
    })

    it('says nothing when the trips only touch, or the Bluefin trip is cancelled', async () => {
        world(NOW)
        paidTrip({ start: '2026-10-22T22:00:00Z', end: '2026-10-25T15:00:00Z', bookedAt: '2026-10-01T12:00:00Z' })
        paidTrip({ start: '2026-10-19T15:00:00Z', end: '2026-10-25T15:00:00Z', bookedAt: '2026-10-01T12:00:00Z', status: 'canceled' })
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        await sync()
        expect(alerts('URGENT')).toHaveLength(0)
    })

    it('tries again on the next run if the email did not send', async () => {
        world(NOW)
        bluefinTripOnTheJeep()
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))

        h.failNextEmails = 1
        const failed = await sync()
        expect(failed.errors).toEqual([expect.stringContaining('Overlap check failed')])
        expect(h.db.rows('schedule_overlap_alerts')).toHaveLength(0)

        await sync()
        expect(alerts('URGENT')).toHaveLength(1)
        expect(h.db.rows('schedule_overlap_alerts')).toHaveLength(1)
    })

    it('catches a Bluefin trip confirmed onto a Turo trip between syncs', async () => {
        world(NOW)
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        await sync()
        expect(alerts('URGENT')).toHaveLength(0)

        bluefinTripOnTheJeep()
        await sync()
        expect(alerts('URGENT')).toHaveLength(1)
    })

    it('warns about a swap onto a busy car, saves it anyway, and alerts', async () => {
        world(NOW)
        paidTrip({ start: '2026-10-21T15:00:00Z', end: '2026-10-25T15:00:00Z', bookedAt: '2026-10-01T12:00:00Z', carId: CAMRY })
        h.gmail.add(booked({ id: 'm1', sentAt: '2026-10-12T12:00:00Z', ...TRIP }))
        h.gmail.add(swapAccepted({ id: 's1', sentAt: '2026-10-12T15:00:00Z', trip: TRIP.trip }))
        await sync()
        signIn(ADMIN)

        const { options } = await getTuroSwapOptions({ data: row()!.id })
        expect(options.find(o => o.id === CAR)!.clashes).toEqual([])
        expect(options.find(o => o.id === CAMRY)!.clashes).toEqual([expect.stringContaining('Bluefin #')])

        const { clashes } = await assignTuroTripCar({ data: { turoBookingId: row()!.id, carId: CAMRY } })
        expect(row()!.car_id).toBe(CAMRY)
        expect(clashes).toHaveLength(1)
        expect(alerts('URGENT')).toHaveLength(1)
    })
})
