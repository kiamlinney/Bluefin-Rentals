import { Link } from '@tanstack/react-router'
import { carMainImageUrl } from '@/lib/car-images.ts'
import { formatBusinessDate, formatBusinessTime } from '@/lib/dates.ts'
import { pickupDisplayName } from '@/components/trip/TripLocation'

// A booked trip in the guest's list.
//
// The whole card is a plain <Link>. It used to be a <div> with an
// `absolute inset-0` overlay anchor, because it also held a Cancel button and
// nesting a button inside an anchor breaks keyboard and screen-reader
// behaviour. Cancelling now lives on the trip page, so the card has no interior
// controls and can be the anchor itself — simpler markup and a real focus ring.

const DATE_FORMAT = { weekday: 'short', month: 'short', day: 'numeric' } as const

function Endpoint({ label, timestamp }: { label: string; timestamp: string }) {
    return (
        <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
            <p className="text-ink font-semibold mt-0.5">
                {formatBusinessDate(timestamp, DATE_FORMAT)}
            </p>
            <p className="text-sm text-muted">{formatBusinessTime(timestamp)}</p>
        </div>
    )
}

export function UpcomingTripCard({ booking }: { booking: any }) {
    const car = booking.cars

    return (
        <Link
            to="/trips/$bookingId"
            params={{ bookingId: booking.id }}
            className="flex flex-col sm:flex-row bg-surface border border-line rounded-md overflow-hidden transition-colors hover:border-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
            <div className="relative w-full sm:w-80 shrink-0 overflow-hidden">
                <img
                    src={carMainImageUrl(car.id)}
                    alt={`${car.make} ${car.model} ${car.year}`}
                    className="w-full aspect-[5/3] sm:aspect-auto sm:h-full object-cover"
                    loading="lazy"
                    decoding="async"
                />
                {/* The plate is how you find the car in a car park, so it sits
                    on the photo rather than in the details column. */}
                {car.license_plate && (
                    <span className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-black/70 text-white text-xs font-bold tracking-wider">
                        {car.license_plate}
                    </span>
                )}
            </div>

            <div className="flex-1 min-w-0 p-5 space-y-4">
                <h3 className="text-xl font-bold text-ink">
                     {car.make} {car.model} {car.year}
                </h3>

                <div className="grid grid-cols-2 gap-4 max-w-sm">
                    <Endpoint label="Starts" timestamp={booking.start_time} />
                    <Endpoint label="Ends" timestamp={booking.end_time} />
                </div>

                <div>
                    <p className="text-xs font-bold tracking-wider text-muted">
                        Pickup &amp; return
                    </p>
                    <p className="text-ink mt-0.5">{pickupDisplayName(booking.pickup_location)}</p>
                </div>
            </div>
        </Link>
    )
}
