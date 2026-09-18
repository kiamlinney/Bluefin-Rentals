import {useState} from "react";
import {buildCheckoutSearch} from "@/lib/checkout-search.ts";
import {CalendarDays, MapPin} from "lucide-react";
import {Link, useRouter} from "@tanstack/react-router";
import {CancelTripDialog} from "@/components/CancelTripDialog.tsx";
import {carMainImageUrl} from "@/lib/car-images.ts";

export function BookingCard({ booking, formatDate, isUpcoming }: { booking: any, formatDate: any, isUpcoming: boolean }) {
    const car = booking.cars
    const router = useRouter()

    // One flag, where there used to be two pieces of state shared between the
    // confirmed and pending cancel blocks — which meant opening either one armed
    // both. They can't both render today, but nothing enforced that.
    const [cancelling, setCancelling] = useState(false)

    // Resuming a pending checkout rebuilds the search params the car page would
    // have produced. Shared with the trip page's unpaid state — see
    // buildCheckoutSearch for why it can't just slice the stored timestamp.
    const checkoutParams = buildCheckoutSearch(booking)

    // This is the only place a guest can cancel. The trip detail page used to
    // carry its own copy of this flow and no longer does.
    const cancelButtonClass =
        "text-sm font-bold text-red-700 hover:text-red-500 transition-colors cursor-pointer"

    return (
        // `relative` anchors the full-card link below. The card can't itself be
        // an <a>: it holds a cancel button and a checkout link, and nesting
        // those inside an anchor breaks both keyboard and screen reader
        // behaviour. The overlay-plus-raised-controls arrangement keeps one
        // large click target without that nesting.
        <div className={`relative flex flex-col md:flex-row gap-6 bg-surface border border-line rounded-2xl p-6 transition-all focus-within:ring-2 focus-within:ring-brand hover:border-ink-400 ${!isUpcoming && 'opacity-80'}`}>

            <Link
                to="/trips/$bookingId"
                params={{ bookingId: booking.id }}
                aria-label={`${car.year} ${car.make} ${car.model}, ${formatDate(booking.start_time)} to ${formatDate(booking.end_time)}`}
                className="absolute inset-0 z-0 rounded-2xl focus:outline-none"
            />

            {/* Car Image */}
            <div className="w-full rounded-lg md:w-48 h-32 flex-shrink-0">
                <img
                    src={carMainImageUrl(car.id)}
                    alt={`${car.make} ${car.model} ${car.year} `}
                    className="w-full h-full border border-line object-cover rounded-xl"
                    loading="lazy"
                    decoding="async"
                />
            </div>

            {/* Details */}
            <div className="flex-1 flex flex-col justify-between">
                <div>
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="text-xl font-bold">{car.make} {car.model} {car.trim} {car.year}</h3>

                        {/* Status Badge */}
                        <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                            booking.status === 'confirmed' ? 'bg-pine-500/80 text-pine-950' :
                                booking.status === 'canceled' ? 'bg-red-900/30 text-red-800' :
                                    booking.status === 'completed' ? 'bg-blue-900/30 text-blue-800' :
                                        booking.status === 'pending' ? 'bg-amber-300/60 text-ink':
                                            'bg-subtle text-muted'

                        }`}>
                            {booking.status.toUpperCase()}
                        </span>
                    </div>

                    {/* Displaying trip times and location */}
                    <div className="flex text-muted items-center gap-2">
                        <CalendarDays size={14} /> {formatDate(booking.start_time)} — {formatDate(booking.end_time)}
                    </div>
                    <div className="flex text-muted items-center gap-2">
                        <MapPin size={14} /> {booking.pickup_location}
                    </div>

                </div>

                {/* z-10 lifts these above the full-card link overlay so they keep
                    their own click targets instead of navigating to the trip. */}
                <div className="relative z-10 flex justify-between items-end mt-4 pt-4 border-t border-line">
                    <div>
                        <p className="text-xs mt-2 text-muted">Total Paid</p>
                        <p className="font-bold">${booking.total_price}</p>
                    </div>

                    {/* Only show Cancel Trip option if status is confirmed and the dates have not past */}
                    {(booking.status === 'confirmed') && (new Date(booking.end_time) >= new Date()) && (
                        <div className="flex flex-col items-end">
                            <button onClick={() => setCancelling(true)} className={cancelButtonClass}>
                                Cancel Trip
                            </button>
                        </div>
                    )}

                    {booking.status === 'pending' && (
                        <div className="flex flex-row gap-x-4 items-center">
                            <button onClick={() => setCancelling(true)} className={cancelButtonClass}>
                                Cancel
                            </button>

                            <Link
                                to="/checkout/$carId"
                                params={{ carId: car.id.toString() }}
                                search={{ ...checkoutParams, bookingId: booking.id }}
                                className="bg-amber-300/60 hover:bg-amber-200/50 text-ink text-xs font-bold px-2 py-2 rounded-lg transition-colors"
                            >
                                Finish Checkout →
                            </Link>
                        </div>
                    )}

                </div>
            </div>

            {cancelling && (
                <CancelTripDialog
                    bookingId={booking.id}
                    totalPaid={Number(booking.total_price)}
                    onClose={() => setCancelling(false)}
                    onCanceled={() => {
                        setCancelling(false)
                        // invalidate() rather than the reload this used to do —
                        // the loader refetches and the card re-renders in place,
                        // keeping scroll position and any other open state.
                        router.invalidate()
                    }}
                />
            )}
        </div>
    )
}