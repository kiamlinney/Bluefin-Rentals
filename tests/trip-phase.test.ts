// tripPhase: what every page says a trip is. Found in rehearsal Test 18
// (2026-10-08): in the hour between a trip's end and the hourly job marking it
// completed, the owner's page said "Booked trip", the guest's "Past trip" under a
// CONFIRMED badge, and the owner's list "Ending at 3:43 pm" at 4:45 pm.

import { describe, expect, it } from 'vitest'
import { tripPhase, TRIP_PHASE_LABEL, type TripPhase } from '../src/lib/booking-status'
import { Constants } from '../src/lib/database.types'

const trip = (status: string) => ({ status, start_time: '2026-10-10T15:00:00Z', end_time: '2026-10-13T15:00:00Z' })
const BEFORE = new Date('2026-10-09T15:00:00Z')
const DURING = new Date('2026-10-11T15:00:00Z')
const JUST_AFTER = new Date('2026-10-13T15:30:00Z') // ended, the hourly job hasn't run

describe('tripPhase', () => {
    // Every status in the database, at each point in a trip's life. A new
    // status fails here until someone decides what pages should call it.
    const expected: Record<(typeof Constants.public.Enums.booking_status)[number], [TripPhase, TripPhase, TripPhase]> = {
        //            before            during           just after
        confirmed: ['upcoming', 'in-progress', 'ended'],
        completed: ['ended', 'ended', 'ended'],
        canceled: ['canceled', 'canceled', 'canceled'],
        pending: ['awaiting-payment', 'awaiting-payment', 'awaiting-payment'],
        expired: ['not-paid', 'not-paid', 'not-paid'],
        failed: ['not-paid', 'not-paid', 'not-paid'],
    }

    for (const status of Constants.public.Enums.booking_status) {
        it(status, () => {
            const want = expected[status]
            expect(want, `no expectation for status "${status}"`).toBeDefined()
            expect([BEFORE, DURING, JUST_AFTER].map(now => tripPhase(trip(status), now))).toEqual(want)
        })
    }

    it('calls a confirmed trip "Completed" the moment it ends, not when the job runs', () => {
        const phase = tripPhase(trip('confirmed'), JUST_AFTER)
        expect(phase).toBe('ended')
        expect(TRIP_PHASE_LABEL[phase]).toBe('Completed')
    })

    it('never lets a cancelled trip with future dates read as upcoming', () => {
        expect(tripPhase(trip('canceled'), BEFORE)).toBe('canceled')
    })
})
