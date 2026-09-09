// Booking rate — whether a trip is refundable, and what that costs.
//
// Pure and isomorphic like pricing.ts / pickup.ts / distance.ts. Imports
// nothing from pricing.ts on purpose: pricing.ts imports the type and the
// surcharge *from here*, so the dependency runs one way and there's no cycle.

// The string values match the Postgres `booking_rate` enum labels exactly, so
// the column value, the URL search param and this type are all the same
// strings and nothing has to be mapped between them.
export type BookingRate = 'non-refundable' | 'refundable'

export const BOOKING_RATES: BookingRate[] = ['non-refundable', 'refundable']

// The anchor. Every price the site quoted before the rate choice existed was
// this rate, which is why it's also the DB column's default 
export const DEFAULT_BOOKING_RATE: BookingRate = 'non-refundable'

// A premium on the trip price, shaped like SAME_DAY_SURCHARGE in pricing.ts so
// the two read alike. Non-refundable is the baseline and is never discounted:
// refundability is the thing being sold, not a discount being withheld.
export const REFUNDABLE_SURCHARGE = { percent: 0.10, label: 'Refundable rate' }

export function isBookingRate(value: unknown): value is BookingRate {
    return value === 'non-refundable' || value === 'refundable'
}

export function bookingRateLabel(rate: BookingRate): string {
    return rate === 'refundable' ? 'Refundable' : 'Non-refundable'
}

// ── Cancellation windows ─────────────────────────────────────────────────────
//
// Display only. Nothing enforces these yet — cancelBooking in db.ts still
// cancels whatever it's asked to — so what this returns is what the guest was
// *told*, not a rule the system applies.
//
// The two rates measure from opposite ends, which is the whole difference
// between them: non-refundable buys a grace period after you commit, refundable
// buys the right to change your mind right up to the trip.

const MS_PER_HOUR = 60 * 60 * 1000
export const FREE_CANCELLATION_HOURS = 24

export function freeCancellationDeadline(
    rate: BookingRate,
    { bookedAt, tripStart }: { bookedAt: Date; tripStart: Date },
): Date {
    return rate === 'refundable'
        ? new Date(tripStart.getTime() - FREE_CANCELLATION_HOURS * MS_PER_HOUR)
        : new Date(bookedAt.getTime() + FREE_CANCELLATION_HOURS * MS_PER_HOUR)
}