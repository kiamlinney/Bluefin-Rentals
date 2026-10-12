// Turo emails as the sync receives them, modelled on real ones (2026-09/10)
// with the names, phone numbers and links taken out. The body text is what
// Gmail's text/plain part holds; the layout (indents, the old time on its own
// line in a change request) is Turo's.

import type { FakeEmail } from './fakes/gmail'

type Trip = {
    /** Gmail message id. */
    id: string
    sentAt: string
    /** Turo reservation id. */
    trip: string
    renter?: string
    /** "Jeep Cherokee 2018": the car line, make model year. */
    car?: string
    /** "10/20/26 11:00 am", business time. */
    start: string
    end: string
}

const carNoYear = (car: string) => car.replace(/\s+\d{4}$/, '')

function tripBlock(t: Required<Pick<Trip, 'car' | 'renter'>> & Trip, by = 'booked by') {
    return [
        `    ${t.car}`,
        `            ${by} ${t.renter}`,
        `            Trip start: ${t.start}`,
        `        Trip end: ${t.end}`,
        `            ${t.renter}`,
        `            Reservation ID #${t.trip}`,
        `    View ${t.renter}’s profile: <url>`,
    ].join('\n')
}

function withDefaults<T extends Trip>(t: T) {
    return { renter: 'Aliyah', car: 'Jeep Cherokee 2018', ...t }
}

export function booked(input: Trip): FakeEmail {
    const t = withDefaults(input)
    return {
        id: t.id,
        sentAt: t.sentAt,
        notification: 'ReservationBookedOwner',
        reservationId: t.trip,
        subject: `${t.renter}’s trip with your ${carNoYear(t.car)} is booked!`,
        body: [
            `${t.renter}’s trip is booked.`,
            `    Cha-ching! ${t.renter}’s trip with your ${carNoYear(t.car)} is booked.`,
            'You’ll earn $234.99.',
            tripBlock(t),
        ].join('\n'),
    }
}

/** RenterChangedRequestOwner: the requested times, then the old one on its own line. */
export function changeRequested(input: Trip & { oldEnd: string }): FakeEmail {
    const t = withDefaults(input)
    return {
        id: t.id,
        sentAt: t.sentAt,
        notification: 'RenterChangedRequestOwner',
        reservationId: t.trip,
        subject: `${t.renter} has requested a change to their trip with your ${carNoYear(t.car)}`,
        body: [
            `${t.renter} has requested a change to their trip`,
            `Here’s what ${t.renter} would like to change:`,
            `New trip end on ${t.end}-`,
            `To confirm or decline, go to <url>`,
            `    ${t.car}`,
            `            Trip start: ${t.start}`,
            `        Trip end: ${t.end}`,
            `                    ${t.oldEnd}`,
            `            Reservation ID #${t.trip}`,
        ].join('\n'),
    }
}

/** ApprovedChangeRequestBookedOwner: no "trip with your" in the subject. */
export function changeConfirmed(input: Trip): FakeEmail {
    const t = withDefaults(input)
    return {
        id: t.id,
        sentAt: t.sentAt,
        notification: 'ApprovedChangeRequestBookedOwner',
        reservationId: t.trip,
        subject: `You’ve confirmed ${t.renter}’s change request with your ${carNoYear(t.car)}`,
        body: [
            'You’ve confirmed their change request',
            `${t.renter}’s change request with your ${carNoYear(t.car)} is now confirmed.`,
            tripBlock(t),
        ].join('\n'),
    }
}

/** AutoApprovedTripChangeHost. */
export function tripChanged(input: Trip): FakeEmail {
    const t = withDefaults(input)
    return {
        id: t.id,
        sentAt: t.sentAt,
        notification: 'AutoApprovedTripChangeHost',
        reservationId: t.trip,
        subject: `${t.renter} has changed their trip with your ${carNoYear(t.car)} (${t.trip})`,
        body: [`${t.renter} has changed their trip`, tripBlock(t)].join('\n'),
    }
}

/** TuroCancelledReservationOwner: has trip dates, which is what used to fool the sync. */
export function turoCanceled(input: Trip): FakeEmail {
    const t = withDefaults(input)
    return {
        id: t.id,
        sentAt: t.sentAt,
        notification: 'TuroCancelledReservationOwner',
        reservationId: t.trip,
        subject: `Turo has canceled ${t.renter}’s trip with your ${carNoYear(t.car)}`,
        body: [
            `Turo canceled ${t.renter}’s trip`,
            `    Turo canceled ${t.renter}’s trip with your ${carNoYear(t.car)}.`,
            tripBlock(t, 'requested by'),
        ].join('\n'),
    }
}

/** VehicleSwapAccepted: the reservation, and nothing about the new car. */
export function swapAccepted(o: { id: string; sentAt: string; trip: string; renter?: string; withHeader?: boolean }): FakeEmail {
    const renter = o.renter ?? 'Aliyah'
    return {
        id: o.id,
        sentAt: o.sentAt,
        notification: 'VehicleSwapAccepted',
        reservationId: o.withHeader === false ? null : o.trip,
        subject: `${renter} accepted your vehicle swap request`,
        body: [
            `${renter} accepted your vehicle swap request`,
            `Great news! ${renter} has approved the vehicle swap for their trip ${o.trip} on October 12, 2026. Please get ready to fulfill the trip with the replacement vehicle.`,
            'As a reminder, your original vehicle is unlisted. Please relist it whenever it becomes available.',
        ].join('\n'),
    }
}
