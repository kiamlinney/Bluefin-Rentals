// What /fleet's date search lists (getAvailableCars), and the rule under it
// (dateRangeIsBookable). It used to call a SQL function under the visitor's
// RLS, which couldn't see anyone else's bookings and listed every car as free.

import { describe, expect, it } from 'vitest'
import { h, signIn } from './harness'
import { world, paidTrip, unpaidCheckout, CAR, GUEST, OTHER_GUEST } from './fixtures'
import { getAvailableCars } from '../src/lib/db'
import {
    buildAvailabilityMap,
    businessTimeSlots,
    dateRangeIsBookable,
    findTripConflict,
    isBusinessSlot,
    searchRangeIsBookable,
    toOccupiedSpans,
} from '../src/lib/availability'
import { addDays } from '../src/lib/pricing'

const NOW = '2026-10-10T17:00:00Z' // noon Central
const listed = async (start: string, end: string, times: { startTime?: string; endTime?: string } = {}) =>
    ((await getAvailableCars({ data: { start, end, ...times } })) as { id: number }[]).map(c => c.id).sort()

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

    it('narrows by the search bar’s optional times', async () => {
        world(NOW)
        // Returns 10am Central on the 16th, so with the turnaround the car can
        // go out again from 1pm that day.
        paidTrip({ start: '2026-10-14T15:00:00Z', end: '2026-10-16T15:00:00Z', bookedAt: NOW, userId: OTHER_GUEST })
        signIn(null)

        expect(await listed('2026-10-16', '2026-10-18')).toEqual([CAR, 7])
        expect(await listed('2026-10-16', '2026-10-18', { startTime: '10:00' })).toEqual([7])
        expect(await listed('2026-10-16', '2026-10-18', { startTime: '13:00' })).toEqual([CAR, 7])
        expect(await listed('2026-10-16', '2026-10-18', { startTime: '13:00', endTime: '15:00' })).toEqual([CAR, 7])
    })

    it('rejects a time that isn’t one of our slots', async () => {
        world(NOW)
        await expect(listed('2026-10-15', '2026-10-16', { startTime: '10:15' })).rejects.toThrow('valid times')
        await expect(listed('2026-10-15', '2026-10-16', { endTime: '3:00' })).rejects.toThrow('valid times')
    })
})

describe('searchRangeIsBookable', () => {
    const map = (rows: Parameters<typeof toOccupiedSpans>[0]) => buildAvailabilityMap(toOccupiedSpans(rows))
    const now = new Date(NOW)
    // Back from a trip at 10am Central on the 16th; out on the next at 3pm on the 20th.
    const m = map([
        { kind: 'booking', start_time: '2026-10-14T15:00:00Z', end_time: '2026-10-16T15:00:00Z' },
        { kind: 'booking', start_time: '2026-10-20T20:00:00Z', end_time: '2026-10-22T20:00:00Z' },
    ])

    it('without times, answers exactly what dateRangeIsBookable does', () => {
        for (let s = 0; s < 16; s++) {
            for (let len = -1; len < 8; len++) {
                const start = addDays('2026-10-09', s)
                const end = addDays(start, len)
                expect(searchRangeIsBookable(start, undefined, end, undefined, m, now), `${start} → ${end}`)
                    .toBe(dateRangeIsBookable(start, end, m, now))
            }
        }
    })

    it('holds a start time to the turnaround after the previous trip', () => {
        expect(searchRangeIsBookable('2026-10-16', '12:30', '2026-10-18', undefined, m, now)).toBe(false)
        expect(searchRangeIsBookable('2026-10-16', '13:00', '2026-10-18', undefined, m, now)).toBe(true)
    })

    it('holds an end time to the turnaround before the next trip', () => {
        expect(searchRangeIsBookable('2026-10-18', undefined, '2026-10-20', '12:30', m, now)).toBe(false)
        expect(searchRangeIsBookable('2026-10-18', undefined, '2026-10-20', '12:00', m, now)).toBe(true)
    })

    it('holds a start time today to the lead time', () => {
        // Noon now, so 3pm is the earliest start today.
        expect(searchRangeIsBookable('2026-10-10', '14:30', '2026-10-12', undefined, m, now)).toBe(false)
        expect(searchRangeIsBookable('2026-10-10', '15:00', '2026-10-12', undefined, m, now)).toBe(true)
    })

    it('with both times, is the car page’s own check', () => {
        for (const [start, startTime, end, endTime] of [
            ['2026-10-16', '13:00', '2026-10-20', '12:00'],
            ['2026-10-16', '12:00', '2026-10-20', '12:00'],
            ['2026-10-16', '13:00', '2026-10-20', '13:00'],
            ['2026-10-17', '10:00', '2026-10-23', '10:00'],
        ]) {
            expect(searchRangeIsBookable(start, startTime, end, endTime, m, now))
                .toBe(findTripConflict(start, startTime, end, endTime, m, now) === null)
        }
    })

    it('needs a same-day trip to end after it starts', () => {
        const free = map([])
        expect(searchRangeIsBookable('2026-10-15', '22:30', '2026-10-15', undefined, free, now)).toBe(true)
        expect(searchRangeIsBookable('2026-10-15', '23:00', '2026-10-15', undefined, free, now)).toBe(false)
    })
})

describe('the search bar’s time slots', () => {
    it('runs from opening to closing, spelled the way the car page spells them', () => {
        const slots = businessTimeSlots()
        expect(slots[0]).toEqual({ value: '10:00', label: '10:00 AM', minutes: 600 })
        expect(slots.at(-1)).toEqual({ value: '23:00', label: '11:00 PM', minutes: 1380 })
        expect(slots.every(s => isBusinessSlot(s.value))).toBe(true)
    })

    it('accepts only those slots from a URL', () => {
        // '10:60' is 11:00 by arithmetic, but not a spelling the dropdown emits.
        for (const bad of ['9:30', '23:30', '10:15', '10:60', '010:00', '10:0', '', 'noon', 600, undefined]) {
            expect(isBusinessSlot(bad), String(bad)).toBe(false)
        }
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
