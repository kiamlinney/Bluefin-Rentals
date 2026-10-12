// Two trips on the same car at the same time. Pure and isomorphic: the sync
// uses it to email the owners (schedule-alerts.server.ts), and the calendar and
// the Booked tab use it to flag the trips, so all three agree on what counts.
//
// The usual cause is a Turo booking landing on dates a Bluefin trip already has
// (Turo's calendar doesn't know about ours), or a Turo swap moved onto the
// wrong car. Checkout can't produce one, since assertCarIsAvailable refuses
// it, but a late payment or a race between two checkouts could, so Bluefin
// trips are checked against each other too.

export type ScheduleTrip = {
    source: 'booking' | 'turo'
    id: string
    car_id: number
    start_time: string
    end_time: string
}

export type ScheduleOverlap = {
    /** Stable, order-independent: what schedule_overlap_alerts claims on. */
    key: string
    car_id: number
    trips: [ScheduleTrip, ScheduleTrip]
}

export const tripKey = (trip: Pick<ScheduleTrip, 'source' | 'id'>) => `${trip.source}:${trip.id}`

/** Bluefin trips that count: confirmed only. A pending hold isn't a trip yet. */
export function bookingTrips(
    bookings: { id: string; car_id: number; start_time: string; end_time: string; status: string }[],
): ScheduleTrip[] {
    return bookings
        .filter(b => b.status === 'confirmed')
        .map(b => ({ source: 'booking', id: b.id, car_id: b.car_id, start_time: b.start_time, end_time: b.end_time }))
}

export function turoTrips(
    trips: { id: string; car_id: number; start_time: string; end_time: string }[],
): ScheduleTrip[] {
    return trips.map(t => ({ source: 'turo', id: t.id, car_id: t.car_id, start_time: t.start_time, end_time: t.end_time }))
}

/**
 * Every pair of trips on the same car whose times actually overlap, ignoring
 * pairs whose shared time is already over. Touching (one ends as the next
 * starts) is not an overlap, and the turnaround buffer doesn't count: this is
 * for two guests expecting the same car at once, not a tight changeover.
 */
export function findScheduleOverlaps(trips: ScheduleTrip[], now: Date): ScheduleOverlap[] {
    const ms = (iso: string) => new Date(iso).getTime()
    const byCar = new Map<number, ScheduleTrip[]>()
    for (const trip of trips) {
        if (ms(trip.end_time) <= now.getTime()) continue
        byCar.set(trip.car_id, [...(byCar.get(trip.car_id) ?? []), trip])
    }

    const overlaps: ScheduleOverlap[] = []
    for (const [carId, carTrips] of byCar) {
        for (let i = 0; i < carTrips.length; i++) {
            for (let j = i + 1; j < carTrips.length; j++) {
                const a = carTrips[i]!
                const b = carTrips[j]!
                if (ms(a.start_time) >= ms(b.end_time) || ms(b.start_time) >= ms(a.end_time)) continue
                if (Math.min(ms(a.end_time), ms(b.end_time)) <= now.getTime()) continue
                const pair = [a, b].sort((x, y) => tripKey(x).localeCompare(tripKey(y))) as [ScheduleTrip, ScheduleTrip]
                overlaps.push({ key: pair.map(tripKey).join('|'), car_id: carId, trips: pair })
            }
        }
    }
    return overlaps.sort((x, y) => ms(x.trips[0].start_time) - ms(y.trips[0].start_time))
}

/** Each trip's overlaps, keyed by tripKey, for flagging trips on a page. */
export function overlapsByTrip(overlaps: ScheduleOverlap[]): Map<string, ScheduleOverlap[]> {
    const map = new Map<string, ScheduleOverlap[]>()
    for (const overlap of overlaps) {
        for (const trip of overlap.trips) {
            const key = tripKey(trip)
            map.set(key, [...(map.get(key) ?? []), overlap])
        }
    }
    return map
}

/** The trip in an overlap that isn't `self`. */
export function otherTrip(overlap: ScheduleOverlap, self: Pick<ScheduleTrip, 'source' | 'id'>): ScheduleTrip {
    return tripKey(overlap.trips[0]) === tripKey(self) ? overlap.trips[1] : overlap.trips[0]
}
