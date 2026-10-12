// What a Turo email means (turoEmailKind) and what it says (the parsers), on
// the real templates. The sync's behaviour on top of these is
// tests/turo-sync.test.ts.

import { describe, expect, it } from 'vitest'
import {
    matchCar,
    parseCarLine,
    parseRenterName,
    parseReservationId,
    parseTripTimes,
    turoEmailKind,
    turoGmailQuery,
    widenForRequest,
} from '../src/lib/turo-email'
import { booked, changeConfirmed, changeRequested, swapAccepted, turoCanceled } from './turo-emails'

const T = { id: 'm', sentAt: '2026-10-12T12:00:00Z', trip: '62239424', start: '10/20/26 11:00 am', end: '10/22/26 5:00 pm' }

describe('turoEmailKind', () => {
    it('reads every Turo template we have seen by its Notification-Name', () => {
        const cases: [string, string][] = [
            ['ReservationBookedOwner', 'trip'],
            ['AutoApprovedTripChangeHost', 'trip'],
            ['ApprovedChangeRequestBookedOwner', 'trip'],
            ['RenterChangedRequestOwner', 'request'],
            ['CancelledReservationOwner', 'cancel'],
            ['TuroCancelledReservationOwner', 'cancel'],
            ['TuroAdminCancelReservationHost', 'cancel'],
            ['VehicleSwapAccepted', 'swap'],
            ['ReservationReminderLongTerm', 'ignore'],
            ['AddDriverToTripOwner', 'ignore'],
        ]
        for (const [name, kind] of cases) expect(turoEmailKind(name, 'anything'), name).toBe(kind)
    })

    it('treats a Turo-initiated cancellation as a cancellation, though its body has trip dates', () => {
        const email = turoCanceled({ ...T })
        expect(turoEmailKind(email.notification, email.subject)).toBe('cancel')
        expect(parseTripTimes(email.body!)).not.toBeNull()
    })

    it('treats a cancellation template it has never seen as a cancellation', () => {
        expect(turoEmailKind('HostCancelledReservationSomething', 'x')).toBe('cancel')
    })

    it('still stores a booking if Turo renames the booking template, and nothing else unknown', () => {
        expect(turoEmailKind('ReservationBookedOwnerV2', 'Aliyah’s trip with your Toyota Corolla is booked!')).toBe('trip')
        expect(turoEmailKind(null, 'Aliyah’s trip with your Toyota Corolla is booked!')).toBe('trip')
        expect(turoEmailKind('SomethingNew', 'Aliyah has an opinion about your Toyota Corolla')).toBe('unknown')
        expect(turoEmailKind(null, 'Turo has canceled Aliyah’s trip with your Toyota Corolla')).toBe('unknown')
    })
})

describe('turoGmailQuery', () => {
    it('asks for the confirmation and swap emails, whose subjects lack "trip with your"', () => {
        const q = turoGmailQuery(30)
        expect(q).toContain('from:@turo.com')
        expect(q).toContain('subject:"trip with your"')
        expect(q).toContain('subject:"change request"')
        expect(q).toContain('subject:"vehicle swap request"')
        expect(q).toContain('newer_than:30d')
        // Each sample subject matches one of the three phrases.
        for (const subject of [
            booked(T).subject,
            changeRequested({ ...T, oldEnd: 'x' }).subject,
            changeConfirmed(T).subject,
            turoCanceled(T).subject,
            swapAccepted(T).subject,
        ]) {
            expect(/trip with your|change request|vehicle swap request/.test(subject), subject).toBe(true)
        }
    })
})

describe('parsing', () => {
    it('reads the trip times as business time, in UTC', () => {
        // October is CDT, UTC-5.
        expect(parseTripTimes(booked(T).body!)).toEqual({
            startTime: '2026-10-20T16:00:00.000Z',
            endTime: '2026-10-22T22:00:00.000Z',
        })
        // Upper-case AM/PM, as on the confirmation and cancellation emails.
        expect(parseTripTimes('Trip start: 10/9/26 7:00 PM\n Trip end: 10/11/26 12:30 AM')).toEqual({
            startTime: '2026-10-10T00:00:00.000Z',
            endTime: '2026-10-11T05:30:00.000Z',
        })
    })

    it('reads a change request’s requested times, not the old one printed after them', () => {
        const email = changeRequested({ ...T, end: '10/21/26 6:30 pm', oldEnd: '10/22/26 11:30 pm' })
        expect(parseTripTimes(email.body!)?.endTime).toBe('2026-10-21T23:30:00.000Z')
    })

    it('reads the renter from every subject shape', () => {
        expect(parseRenterName(booked({ ...T, renter: 'Zachary' }).subject)).toBe('Zachary')
        expect(parseRenterName(changeRequested({ ...T, renter: 'Juhar', oldEnd: 'x' }).subject)).toBe('Juhar')
        expect(parseRenterName(changeConfirmed({ ...T, renter: 'Jasmine' }).subject)).toBe('Jasmine')
        expect(parseRenterName('Travis has changed their trip with your Honda Civic (60011662)')).toBe('Travis')
        expect(parseRenterName('Max accepted your vehicle swap request')).toBeNull()
    })

    it('finds the reservation id in the header, else the body', () => {
        expect(parseReservationId('62239424', null)).toBe('62239424')
        expect(parseReservationId(null, booked(T).body!)).toBe('62239424')
        expect(parseReservationId(null, swapAccepted({ ...T, trip: '61595209' }).body!)).toBe('61595209')
        expect(parseReservationId(null, 'nothing here')).toBeNull()
    })

    it('matches the car on year, make and model, and refuses to guess', () => {
        const cars = [
            { id: 3, make: 'Ford', model: 'Fusion', year: 2015, is_available: true },
            { id: 4, make: 'Ford', model: 'Fusion Hybrid', year: 2012, is_available: true },
            { id: 5, make: 'Jeep', model: 'Cherokee', year: 2018, is_available: true },
            { id: 6, make: 'Jeep', model: 'Cherokee', year: 2018, is_available: false },
        ]
        const line = (car: string) => parseCarLine(booked({ ...T, car }).body!)
        expect(matchCar(cars, line('Ford Fusion 2015'))).toEqual({ car: cars[0] })
        expect(matchCar(cars, line('Ford Fusion Hybrid 2012'))).toEqual({ car: cars[1] })
        // The retired twin loses to the active one.
        expect(matchCar(cars, line('Jeep Cherokee 2018'))).toEqual({ car: cars[2] })
        expect(matchCar(cars, line('Honda Civic 2013'))).toEqual({ error: 'could not match car "Honda Civic 2013"' })
        expect('error' in matchCar([...cars, { id: 9, make: 'Jeep', model: 'Cherokee', year: 2018, is_available: true }], line('Jeep Cherokee 2018'))).toBe(true)
    })
})

describe('widenForRequest', () => {
    const current = { start_time: '2026-10-20T16:00:00Z', end_time: '2026-10-22T22:00:00Z' }

    it('never shortens: a requested earlier end keeps the original end', () => {
        expect(widenForRequest(current, { startTime: '2026-10-20T16:00:00Z', endTime: '2026-10-21T22:00:00Z' })).toEqual(current)
    })

    it('blocks a requested extension, and an earlier start', () => {
        expect(widenForRequest(current, { startTime: '2026-10-19T16:00:00Z', endTime: '2026-10-24T22:00:00Z' })).toEqual({
            start_time: '2026-10-19T16:00:00Z',
            end_time: '2026-10-24T22:00:00Z',
        })
    })
})
