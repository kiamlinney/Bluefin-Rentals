import { useMemo } from 'react'
import type { BookingWithRelations, TuroBooking } from '@/types.ts'
import { formatBusinessDate } from '@/lib/dates.ts'
import {
    bookingTrips,
    findScheduleOverlaps,
    otherTrip,
    tripKey,
    turoTrips,
    type ScheduleOverlap,
} from '@/lib/schedule-overlaps'
import { isTuroSwapPending, turoReservationUrl } from '@/lib/turo-swap'

// What the admin calendar and the Booked tab flag: trips overlapping on the
// same car (red) and Turo swaps waiting for us to pick the car (amber). Worked
// out from the rows the page already loaded, with the same rules the alert
// emails use, so a flag clears the moment the cause is gone.

export type TripRef = {
    /** "Bluefin #7A6E4F3B" or "Turo #62239424". */
    reference: string
    who: string
    start_time: string
    end_time: string
    /** Our reservation page, or the trip on turo.com. */
    href: string | null
    external: boolean
}

function bookingRef(b: BookingWithRelations): TripRef {
    return {
        reference: `Bluefin #${b.id.slice(0, 8).toUpperCase()}`,
        who: b.profiles?.full_name ?? b.profiles?.email?.split('@')[0] ?? 'Guest',
        start_time: b.start_time,
        end_time: b.end_time,
        href: `/admin/reservation/${b.id}`,
        external: false,
    }
}

function turoRef(t: TuroBooking): TripRef {
    return {
        reference: t.turo_trip_id ? `Turo #${t.turo_trip_id}` : 'Turo trip',
        who: t.renter_name ?? 'Turo guest',
        start_time: t.start_time,
        end_time: t.end_time,
        href: t.turo_trip_id ? turoReservationUrl(t.turo_trip_id) : null,
        external: true,
    }
}

export function shortDates(start: string, end: string): string {
    const day = (iso: string) => formatBusinessDate(iso, { month: 'short', day: 'numeric' })
    return `${day(start)} – ${day(end)}`
}

export function useScheduleFlags(bookings: BookingWithRelations[], turoBookings: TuroBooking[]) {
    return useMemo(() => {
        const refs = new Map<string, TripRef>()
        for (const b of bookings) refs.set(tripKey({ source: 'booking', id: b.id }), bookingRef(b))
        for (const t of turoBookings) refs.set(tripKey({ source: 'turo', id: t.id }), turoRef(t))

        const overlaps: ScheduleOverlap[] = findScheduleOverlaps(
            [...bookingTrips(bookings), ...turoTrips(turoBookings)],
            new Date(),
        )

        // One line per flagged trip: what it overlaps.
        const overlapNotes = new Map<string, string>()
        for (const overlap of overlaps) {
            for (const trip of overlap.trips) {
                const other = refs.get(tripKey(otherTrip(overlap, trip)))
                const note = `Overlaps ${other?.reference ?? 'another trip'}${other ? ` (${other.who})` : ''}`
                const key = tripKey(trip)
                overlapNotes.set(key, overlapNotes.has(key) ? `${overlapNotes.get(key)}; ${note}` : note)
            }
        }

        return {
            overlaps,
            overlapNotes,
            refs,
            pendingSwaps: turoBookings.filter(isTuroSwapPending),
        }
    }, [bookings, turoBookings])
}
