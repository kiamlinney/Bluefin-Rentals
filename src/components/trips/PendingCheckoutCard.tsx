import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { cancelBooking } from '@/lib/db'
import { buildCheckoutSearch } from '@/lib/checkout-search.ts'
import { carMainImageUrl } from '@/lib/car-images.ts'
import { formatBusinessDate } from '@/lib/dates.ts'

// An abandoned checkout the guest can pick back up.
//
// Discarding one gets a plain inline confirm rather than CancelTripDialog. That
// dialog exists to quote a refund, and there is nothing to refund here: the
// hold was never charged. It would render "Nothing has been charged" over an
// empty reason box, which reads like a bug. See cancelBooking, which marks a
// discarded hold `expired` and sends no email.

const DATE_FORMAT = { month: 'short', day: 'numeric' } as const

export function PendingCheckoutCard({ booking }: { booking: any }) {
    const car = booking.cars
    const router = useRouter()

    const [confirming, setConfirming] = useState(false)
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const discard = async () => {
        setWorking(true)
        setError(null)
        try {
            await cancelBooking({ data: { bookingId: booking.id } })
            await router.invalidate()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not discard that checkout.')
            setWorking(false)
        }
    }

    return (
        <div className="bg-surface border border-line rounded-2xl p-5">
            <div className="flex flex-col sm:flex-row gap-5">
                <img
                    src={carMainImageUrl(car.id)}
                    alt={`${car.make} ${car.model} ${car.year}`}
                    className="w-full sm:w-40 h-28 object-cover rounded-xl border border-line shrink-0"
                    loading="lazy"
                    decoding="async"
                />

                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-bold text-ink">
                            {car.make} {car.model} {car.year}
                        </h3>
                        <span className="shrink-0 text-xs font-bold px-3 py-1 rounded-full bg-amber-300/60 text-ink">
                            NOT BOOKED
                        </span>
                    </div>

                    <p className="text-sm text-muted mt-1">
                        {formatBusinessDate(booking.start_time, DATE_FORMAT)} –{' '}
                        {formatBusinessDate(booking.end_time, DATE_FORMAT)}
                    </p>
                    <p className="text-sm text-muted">
                        These dates aren't held for long, and other renters can still book them.
                    </p>
                </div>
            </div>

            {confirming ? (
                <div className="mt-4 pt-4 border-t border-line">
                    <p className="text-sm text-ink">
                        Discard this checkout? The dates go back on sale and nothing is charged.
                    </p>
                    {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
                    <div className="flex gap-3 mt-3">
                        <button
                            type="button"
                            onClick={discard}
                            disabled={working}
                            className="px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-bold hover:bg-red-800 transition-colors cursor-pointer disabled:opacity-50"
                        >
                            {working ? 'Discarding…' : 'Discard checkout'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirming(false)}
                            disabled={working}
                            className="px-4 py-2 rounded-lg border border-line text-ink text-sm font-bold hover:bg-subtle transition-colors cursor-pointer disabled:opacity-50"
                        >
                            Keep it
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-line">
                    <button
                        type="button"
                        onClick={() => setConfirming(true)}
                        className="text-sm font-bold text-muted hover:text-red-700 transition-colors cursor-pointer"
                    >
                        Discard
                    </button>

                    <Link
                        to="/checkout/$carId"
                        params={{ carId: car.id.toString() }}
                        search={{ ...buildCheckoutSearch(booking), bookingId: booking.id }}
                        className="px-4 py-2 rounded-lg bg-brand text-on-brand text-sm font-bold hover:bg-pine-800 transition-colors"
                    >
                        Finish checkout →
                    </Link>
                </div>
            )}
        </div>
    )
}
