import { Link } from '@tanstack/react-router'
import { carMainImageUrl } from '@/lib/car-images.ts'
import { formatBusinessDate } from '@/lib/dates.ts'

// A finished or cancelled trip, in the History list.
//
// Compact on purpose: these are rows you scan, not cards you act on. The dates
// are struck through for a cancelled trip, which says "this was going to happen
// and didn't" without removing the information.

const DATE_FORMAT = { month: 'short', day: 'numeric' } as const
const CANCELED_FORMAT = { month: 'short', day: 'numeric' } as const

function historyLine(booking: any): string {
    if (booking.status !== 'canceled') return 'Trip completed'

    const when = booking.canceled_at
        ? ` on ${formatBusinessDate(booking.canceled_at, CANCELED_FORMAT)}`
        : ''

    // canceled_by distinguishes the two, and they read very differently to the
    // person who didn't do it.
    return booking.canceled_by === 'admin'
        ? `Bluefin canceled${when}`
        : `You canceled${when}`
}

export function TripHistoryRow({ booking }: { booking: any }) {
    const car = booking.cars
    const isCanceled = booking.status === 'canceled'

    return (
        <Link
            to="/trips/$bookingId"
            params={{ bookingId: booking.id }}
            className="flex items-center justify-between gap-4 bg-subtle rounded-md p-4 transition-colors hover:bg-cream-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
            <div className="min-w-0">
                <p className={`text-sm ${isCanceled ? 'text-muted line-through' : 'text-muted'}`}>
                    {formatBusinessDate(booking.start_time, DATE_FORMAT)} –{' '}
                    {formatBusinessDate(booking.end_time, { ...DATE_FORMAT, year: 'numeric' })}
                </p>
                <p className="font-bold text-ink truncate">
                    {car.make} {car.model} {car.year}
                </p>
                <p className="text-sm text-muted">{historyLine(booking)}</p>
            </div>

            <img
                src={carMainImageUrl(car.id)}
                alt=""
                aria-hidden
                className="w-16 h-12 object-cover rounded-md border border-line shrink-0"
                loading="lazy"
                decoding="async"
            />
        </Link>
    )
}
