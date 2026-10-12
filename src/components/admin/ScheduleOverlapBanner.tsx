import { Link } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import type { Car } from '@/types.ts'
import { tripKey, type ScheduleOverlap } from '@/lib/schedule-overlaps'
import { shortDates, type TripRef } from '@/components/admin/useScheduleFlags'

// The red flag on the calendar and the Booked tab: two trips on the same car at
// the same time. The owners are also emailed (once per overlap) by the sync.

export function ScheduleOverlapBanner({
    overlaps,
    refs,
    cars,
}: {
    overlaps: ScheduleOverlap[]
    refs: Map<string, TripRef>
    cars: Car[]
}) {
    if (overlaps.length === 0) return null
    return (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            <p className="flex items-center gap-2 font-bold">
                <AlertTriangle size={16} />
                {overlaps.length === 1 ? 'Two trips overlap on the same car' : `${overlaps.length} overlapping trips`}
            </p>
            <p className="mt-1 text-red-800">One trip in each pair has to move to another car or be cancelled before it starts.</p>
            <ul className="mt-2 space-y-1">
                {overlaps.map(overlap => {
                    const car = cars.find(c => c.id === overlap.car_id)
                    const [a, b] = overlap.trips.map(trip => refs.get(tripKey(trip)))
                    return (
                        <li key={overlap.key}>
                            <span className="font-semibold">{car ? `${car.make} ${car.model} ${car.year}` : `Car ${overlap.car_id}`}:</span>{' '}
                            <TripLink trip={a} /> and <TripLink trip={b} />
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}

function TripLink({ trip }: { trip: TripRef | undefined }) {
    if (!trip) return <span>another trip</span>
    const text = `${trip.reference} (${trip.who}, ${shortDates(trip.start_time, trip.end_time)})`
    if (!trip.href) return <span>{text}</span>
    if (trip.external) {
        return <a href={trip.href} target="_blank" rel="noopener noreferrer" className="underline">{text}</a>
    }
    return <Link to={trip.href} className="underline">{text}</Link>
}
