// The overlap rule the alert emails and the calendar flags share.

import { describe, expect, it } from 'vitest'
import {
    bookingTrips,
    findScheduleOverlaps,
    overlapsByTrip,
    otherTrip,
    turoTrips,
    type ScheduleTrip,
} from '../src/lib/schedule-overlaps'
import { Constants } from '../src/lib/database.types'

const NOW = new Date('2026-10-12T17:00:00Z')

const booking = (id: string, car: number, start: string, end: string, status = 'confirmed') =>
    ({ id, car_id: car, start_time: start, end_time: end, status })
const turo = (id: string, car: number, start: string, end: string) =>
    ({ id, car_id: car, start_time: start, end_time: end })

const keys = (trips: ScheduleTrip[]) => findScheduleOverlaps(trips, NOW).map(o => o.key)

describe('findScheduleOverlaps', () => {
    it('finds a Bluefin trip and a Turo trip on the same car at once', () => {
        const trips = [
            ...bookingTrips([booking('b1', 5, '2026-10-14T15:00:00Z', '2026-10-17T15:00:00Z')]),
            ...turoTrips([turo('t1', 5, '2026-10-16T15:00:00Z', '2026-10-18T15:00:00Z')]),
        ]
        expect(keys(trips)).toEqual(['booking:b1|turo:t1'])
    })

    it('finds two Bluefin trips, and two Turo trips, on the same car', () => {
        expect(keys(bookingTrips([
            booking('b1', 5, '2026-10-14T15:00:00Z', '2026-10-17T15:00:00Z'),
            booking('b2', 5, '2026-10-15T15:00:00Z', '2026-10-16T15:00:00Z'),
        ]))).toEqual(['booking:b1|booking:b2'])
        expect(keys(turoTrips([
            turo('t1', 5, '2026-10-14T15:00:00Z', '2026-10-17T15:00:00Z'),
            turo('t2', 5, '2026-10-15T15:00:00Z', '2026-10-16T15:00:00Z'),
        ]))).toEqual(['turo:t1|turo:t2'])
    })

    it('does not count trips that only touch, or are on different cars', () => {
        expect(keys([
            ...bookingTrips([booking('b1', 5, '2026-10-14T15:00:00Z', '2026-10-17T15:00:00Z')]),
            ...turoTrips([
                turo('t1', 5, '2026-10-17T15:00:00Z', '2026-10-18T15:00:00Z'),
                turo('t2', 7, '2026-10-14T15:00:00Z', '2026-10-17T15:00:00Z'),
            ]),
        ])).toEqual([])
    })

    it('ignores every status but confirmed', () => {
        for (const status of Constants.public.Enums.booking_status) {
            const found = keys([
                ...bookingTrips([booking('b1', 5, '2026-10-14T15:00:00Z', '2026-10-17T15:00:00Z', status)]),
                ...turoTrips([turo('t1', 5, '2026-10-15T15:00:00Z', '2026-10-16T15:00:00Z')]),
            ])
            expect(found.length, status).toBe(status === 'confirmed' ? 1 : 0)
        }
    })

    it('ignores an overlap that is already over, but not one still going on', () => {
        expect(keys([
            ...bookingTrips([booking('b1', 5, '2026-10-01T15:00:00Z', '2026-10-05T15:00:00Z')]),
            ...turoTrips([turo('t1', 5, '2026-10-02T15:00:00Z', '2026-10-04T15:00:00Z')]),
        ])).toEqual([])
        // The shared time runs past now.
        expect(keys([
            ...bookingTrips([booking('b1', 5, '2026-10-10T15:00:00Z', '2026-10-30T15:00:00Z')]),
            ...turoTrips([turo('t1', 5, '2026-10-11T15:00:00Z', '2026-10-13T15:00:00Z')]),
        ])).toEqual(['booking:b1|turo:t1'])
    })

    it('names a pair the same way whichever order the trips come in', () => {
        const b = bookingTrips([booking('b1', 5, '2026-10-14T15:00:00Z', '2026-10-17T15:00:00Z')])
        const t = turoTrips([turo('t1', 5, '2026-10-16T15:00:00Z', '2026-10-18T15:00:00Z')])
        expect(keys([...t, ...b])).toEqual(keys([...b, ...t]))
    })
})

describe('overlapsByTrip', () => {
    it('flags both trips, and each can find the other', () => {
        const overlaps = findScheduleOverlaps([
            ...bookingTrips([booking('b1', 5, '2026-10-14T15:00:00Z', '2026-10-17T15:00:00Z')]),
            ...turoTrips([turo('t1', 5, '2026-10-16T15:00:00Z', '2026-10-18T15:00:00Z')]),
        ], NOW)
        const byTrip = overlapsByTrip(overlaps)
        expect([...byTrip.keys()].sort()).toEqual(['booking:b1', 'turo:t1'])
        expect(otherTrip(byTrip.get('booking:b1')![0]!, { source: 'booking', id: 'b1' }).id).toBe('t1')
        expect(otherTrip(byTrip.get('turo:t1')![0]!, { source: 'turo', id: 't1' }).id).toBe('b1')
    })
})
