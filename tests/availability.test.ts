// What /fleet's date search lists (getAvailableCars), and the rule under it
// (dateRangeIsBookable). It used to call a SQL function under the visitor's
// RLS, which couldn't see anyone else's bookings and listed every car as free.

import { describe, expect, it } from 'vitest'
import { h, signIn } from './harness'
import { world, paidTrip, unpaidCheckout, CAR, GUEST, OTHER_GUEST } from './fixtures'
import { getAvailableCars } from '../src/lib/db'
import { buildAvailabilityMap, dateRangeIsBookable, toOccupiedSpans } from '../src/lib/availability'

const NOW = '2026-10-10T17:00:00Z'
const listed = async (start: string, end: string) =>
    ((await getAvailableCars({ data: { start, end } })) as { id: number }[]).map(c => c.id).sort()

describe('the /fleet date search', () => {
    it('hides a car that is booked, on a Turo trip, or blocked, for anyone searching', async () => {
        world(NOW)
        paidTrip({ start: '2026-10-14T15:00:00Z', end: '2026-10-17T15:00:00Z', bookedAt: NOW, userId: OTHER_GUEST })
        signIn(null)

        expect(await listed('2026-10-15', '2026-10-16')).toEqual([7])
        expect(await listed('2026-10-20', '2026-10-21')).toEqual([CAR, 7])

        h.db.insert('turo_bookings', { car_id: 7, start_time: '2026-10-20T15:00:00Z', end_time: '2026-10-22T15:00:00Z', turo_trip_id: 't1' })
        expect(await listed('2026-10-21', '2026-10-21')).toEqual([CAR])

        h.db.insert('car_blocked_dates', { car_id: CAR, start_date: '2026-10-21', end_date: '2026-10-21' })
        expect(await listed('2026-10-21', '2026-10-21')).toEqual([])
    })

    it('respects another guest’s live checkout hold, but not your own', async () => {
        world(NOW)
        unpaidCheckout({ start: '2026-10-14T15:00:00Z', end: '2026-10-16T15:00:00Z', createdAt: '2026-10-10T16:45:00Z', userId: GUEST })

        signIn(OTHER_GUEST)
        expect(await listed('2026-10-15', '2026-10-15')).toEqual([7])
        signIn(GUEST)
        expect(await listed('2026-10-15', '2026-10-15')).toEqual([CAR, 7])
    })

    it('ignores a checkout hold that has lapsed, and cars taken off the site', async () => {
        world(NOW)
        unpaidCheckout({ start: '2026-10-14T15:00:00Z', end: '2026-10-16T15:00:00Z', createdAt: '2026-10-10T14:00:00Z', userId: GUEST })
        h.db.rows('cars').find(c => c.id === 7)!.is_available = false
        signIn(OTHER_GUEST)
        expect(await listed('2026-10-15', '2026-10-15')).toEqual([CAR])
    })

    it('rejects malformed dates instead of guessing', async () => {
        world(NOW)
        await expect(getAvailableCars({ data: { start: '2026-10-15T00:00:00Z', end: '2026-10-16' } })).rejects.toThrow('valid dates')
    })
})

describe('dateRangeIsBookable', () => {
    const map = (rows: Parameters<typeof toOccupiedSpans>[0]) => buildAvailabilityMap(toOccupiedSpans(rows))
    const now = new Date(NOW)

    it('needs the whole trip free, with the turnaround either side', () => {
        // A trip ending 9pm Central on the 15th: the 15th can't host a start.
        const m = map([{ kind: 'booking', start_time: '2026-10-13T15:00:00Z', end_time: '2026-10-16T02:00:00Z' }])
        expect(dateRangeIsBookable('2026-10-14', '2026-10-14', m, now)).toBe(false)
        expect(dateRangeIsBookable('2026-10-15', '2026-10-15', m, now)).toBe(false)
        expect(dateRangeIsBookable('2026-10-16', '2026-10-18', m, now)).toBe(true)
        // It starts at 10am on the 13th, the moment we open, so with the 3-hour
        // turnaround nothing can be returned that day; the 12th is fine.
        expect(dateRangeIsBookable('2026-10-11', '2026-10-13', m, now)).toBe(false)
        expect(dateRangeIsBookable('2026-10-11', '2026-10-12', m, now)).toBe(true)
        expect(dateRangeIsBookable('2026-10-11', '2026-10-17', m, now)).toBe(false) // straddles it
    })

    it('refuses dates in the past and a range that ends before it starts', () => {
        const m = map([])
        expect(dateRangeIsBookable('2026-10-09', '2026-10-12', m, now)).toBe(false)
        expect(dateRangeIsBookable('2026-10-15', '2026-10-14', m, now)).toBe(false)
        expect(dateRangeIsBookable('2026-10-15', '2026-10-15', m, now)).toBe(true)
    })

    it('treats an admin block as whole days, free again the day after', () => {
        const m = map([{ kind: 'block', start_date: '2026-10-15', end_date: '2026-10-16' }])
        expect(dateRangeIsBookable('2026-10-16', '2026-10-16', m, now)).toBe(false)
        expect(dateRangeIsBookable('2026-10-17', '2026-10-18', m, now)).toBe(true)
    })
})
