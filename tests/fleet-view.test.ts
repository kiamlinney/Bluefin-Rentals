// The fleet helpers behind the calendar toolbar and the Vehicles pages.

import { describe, expect, it } from 'vitest'
import {
    bookedDaysAhead,
    matchesCarSearch,
    passesListingFilter,
    billedDateKeys,
    sortCars,
    tripCount,
    vehicleTripStatus,
    type FleetCar,
} from '../src/lib/fleet-view'

const car = (id: number, make: string, model: string, year: number, plate: string | null, listed = true): FleetCar => ({
    id, make, model, year, trim: id === 3 ? 'SE' : null, license_plate: plate, is_available: listed,
})

const EDGE = car(1, 'Ford', 'Edge', 2013, 'KME495')
const FUSION = car(3, 'Ford', 'Fusion', 2015, 'MYG125')
const CRV = car(4, 'Honda', 'CR-V', 2017, 'RUS377')
const JEEP = car(5, 'Jeep', 'Cherokee', 2018, null, false)
const FLEET = [JEEP, CRV, FUSION, EDGE]

// Central time is UTC-5 in October.
const ct = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`).toISOString()
const trip = (start: string, end: string) => ({ start_time: start, end_time: end })

describe('search', () => {
    it('matches make, model, year, trim and plate, ignoring case, spaces and dashes', () => {
        expect(matchesCarSearch(CRV, 'honda')).toBe(true)
        expect(matchesCarSearch(CRV, 'cr v')).toBe(true)
        expect(matchesCarSearch(CRV, 'crv')).toBe(true)
        expect(matchesCarSearch(CRV, '2017')).toBe(true)
        expect(matchesCarSearch(CRV, 'rus 377')).toBe(true)
        expect(matchesCarSearch(FUSION, 'fusion se')).toBe(true)
        expect(matchesCarSearch(CRV, 'honda 2018')).toBe(false)
        expect(matchesCarSearch(CRV, '   ')).toBe(true)
    })
})

describe('listing filter', () => {
    it('keeps the ticked statuses; nothing ticked keeps everything', () => {
        expect(FLEET.filter(c => passesListingFilter(c, ['listed'])).map(c => c.id)).toEqual([4, 3, 1])
        expect(FLEET.filter(c => passesListingFilter(c, ['unlisted'])).map(c => c.id)).toEqual([5])
        expect(FLEET.filter(c => passesListingFilter(c, [])).length).toBe(4)
        // A null is_available has always meant listed.
        expect(passesListingFilter({ is_available: null }, ['listed'])).toBe(true)
    })
})

describe('sort', () => {
    const prices: Record<number, number> = { 1: 50, 3: 70, 4: 70, 5: 60 }
    const booked: Record<number, number> = { 1: 3, 3: 0, 4: 12, 5: 3 }
    const ctx = { todaysPrice: (c: FleetCar) => prices[c.id]!, bookedDays: (c: FleetCar) => booked[c.id]! }
    const ids = (sort: Parameters<typeof sortCars>[1]) => sortCars(FLEET, sort, ctx).map(c => c.id)

    it('sorts by name both ways', () => {
        expect(ids('name-asc')).toEqual([1, 3, 4, 5])
        expect(ids('name-desc')).toEqual([5, 4, 3, 1])
    })
    it('sorts by plate, cars without one last either way', () => {
        expect(ids('plate-asc')).toEqual([1, 3, 4, 5])
        expect(ids('plate-desc')).toEqual([4, 3, 1, 5])
    })
    it('sorts by today’s price, ties broken by name', () => {
        expect(ids('price-desc')).toEqual([3, 4, 5, 1])
        expect(ids('price-asc')).toEqual([1, 5, 3, 4])
    })
    it('sorts by booked days, ties broken by name', () => {
        expect(ids('booked-desc')).toEqual([4, 1, 5, 3])
        expect(ids('booked-asc')).toEqual([3, 1, 5, 4])
    })
    it('never mutates its input', () => {
        const copy = [...FLEET]
        sortCars(FLEET, 'name-desc', ctx)
        expect(FLEET).toEqual(copy)
    })
})

describe('booked days', () => {
    it('counts the billed dates, the same rule as pricing', () => {
        expect(billedDateKeys(trip(ct('2026-10-16', '10:00'), ct('2026-10-18', '10:00')))).toEqual(['2026-10-16', '2026-10-17'])
        expect(billedDateKeys(trip(ct('2026-10-16', '10:00'), ct('2026-10-18', '20:00')))).toEqual(['2026-10-16', '2026-10-17', '2026-10-18'])
    })

    it('counts overlapping trips once and stays inside the window', () => {
        const today = '2026-10-13'
        const trips = [
            trip(ct('2026-10-12', '10:00'), ct('2026-10-15', '10:00')), // 12, 13, 14 → 13 and 14 count
            trip(ct('2026-10-14', '12:00'), ct('2026-10-16', '12:00')), // Turo, overlapping: 14, 15
            trip(ct('2026-11-11', '10:00'), ct('2026-11-14', '10:00')), // 11 Nov is day 30; 12+ are outside
        ]
        // 13, 14, 15 and Nov 11.
        expect(bookedDaysAhead(trips, today)).toBe(4)
        expect(bookedDaysAhead([], today)).toBe(0)
    })
})

describe('trip count', () => {
    const now = new Date(ct('2026-10-20', '12:00'))
    const enteredAt = ct('2026-10-14', '12:00')
    const turo = [
        trip(ct('2026-10-10', '10:00'), ct('2026-10-12', '10:00')), // ended before the count: already in it
        trip(ct('2026-10-13', '10:00'), ct('2026-10-15', '10:00')), // under way when entered: counts once it ends
        trip(ct('2026-10-17', '10:00'), ct('2026-10-19', '10:00')), // after: counts
        trip(ct('2026-10-19', '10:00'), ct('2026-10-22', '10:00')), // not over yet
    ]

    it('adds Turo trips that end after the count was entered, and every Bluefin trip', () => {
        expect(tripCount({ turoBaseline: 83, turoBaselineAt: enteredAt, turoTrips: turo, bluefinCompleted: 4, now }))
            .toEqual({ total: 89, turoBaseline: 83, turoBaselineAt: enteredAt, turoSince: 2, bluefin: 4 })
    })

    it('is Bluefin trips only until a Turo count is entered', () => {
        expect(tripCount({ turoBaseline: null, turoBaselineAt: null, turoTrips: turo, bluefinCompleted: 4, now }).total).toBe(4)
        // A count without its date can't be added to, so it's ignored too.
        expect(tripCount({ turoBaseline: 83, turoBaselineAt: null, turoTrips: turo, bluefinCompleted: 4, now }).total).toBe(4)
    })

    it('counts a Turo count of zero', () => {
        expect(tripCount({ turoBaseline: 0, turoBaselineAt: enteredAt, turoTrips: [], bluefinCompleted: 0, now }).total).toBe(0)
        expect(tripCount({ turoBaseline: 0, turoBaselineAt: enteredAt, turoTrips: turo, bluefinCompleted: 0, now }).turoSince).toBe(2)
    })
})

describe('what a car is doing', () => {
    const now = new Date(ct('2026-10-13', '12:00'))
    const past = trip(ct('2026-10-01', '10:00'), ct('2026-10-03', '10:00'))
    const current = trip(ct('2026-10-12', '10:00'), ct('2026-10-14', '10:00'))
    const soon = trip(ct('2026-10-20', '10:00'), ct('2026-10-22', '10:00'))
    const later = trip(ct('2026-11-01', '10:00'), ct('2026-11-03', '10:00'))

    it('on a trip beats the next trip, which beats the last one', () => {
        expect(vehicleTripStatus([past, later, current, soon], now)).toEqual({ kind: 'on-trip', trip: current })
        expect(vehicleTripStatus([past, later, soon], now)).toEqual({ kind: 'next', trip: soon })
        expect(vehicleTripStatus([past], now)).toEqual({ kind: 'last', trip: past })
        expect(vehicleTripStatus([], now)).toEqual({ kind: 'none' })
    })

    it('a trip that ends right now is over', () => {
        const endsNow = trip(ct('2026-10-11', '12:00'), ct('2026-10-13', '12:00'))
        expect(vehicleTripStatus([endsNow], now).kind).toBe('last')
    })
})
