import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { CarFront, Check, Plane } from 'lucide-react'
import { cancelBooking, getTripForGuest, type TripPaymentState } from '@/lib/db'
import { buildCheckoutSearch } from '@/lib/checkout-search'
import {
    formatBusinessDate,
    formatBusinessTime,
    getRelativeTimeString,
} from '@/lib/dates'

// The guest's permanent page for one trip. This replaced /booking-confirmed,
// which was a one-shot receipt with no authorization of its own and no idea
// whether the payment had actually gone through.
//
// Confirmation is a state of this page rather than a page of its own — the same
// URL serves the moment after checkout, the week before pickup, and the year
// after the trip ended. `?booked=1` is what distinguishes "just arrived from
// checkout" from "opened this from My Bookings", and nothing else depends on it.
export const Route = createFileRoute('/_authed/trips/$bookingId')({
    validateSearch: z.object({
        booked: z.literal('1').optional(),
    }),
    loader: async ({ params }) => getTripForGuest({ data: params.bookingId }),
    component: TripPage,
})

const DATE_FORMAT = { weekday: 'long', month: 'long', day: 'numeric' } as const

// How long to keep re-checking a payment Stripe says is still in flight. Six
// tries at five seconds covers the usual webhook delay; past that, telling the
// guest to check back is more honest than a spinner that never resolves.
const PROCESSING_POLL_MS = 5000
const PROCESSING_POLL_LIMIT = 6

const STATUS_BADGE: Record<string, string> = {
    confirmed: 'bg-[#3a7d2c]/80 text-green-950',
    canceled: 'bg-red-900/30 text-red-800',
    completed: 'bg-blue-900/30 text-blue-800',
    pending: 'bg-amber-300/60 text-black',
}

function TripPage() {
    const { booking, paymentState, card } = Route.useLoaderData()
    const { booked } = Route.useSearch()
    const router = useRouter()

    const car = booking.cars

    const startDate = new Date(booking.start_time)
    const endDate = new Date(booking.end_time)
    const now = new Date()

    const hasStarted = now >= startDate
    const hasEnded = now >= endDate

    // getTripForGuest selects trip_media(count), which PostgREST returns as a
    // one-element array of aggregates.
    const mediaCount = booking.trip_media?.[0]?.count ?? 0

    const isPaid = paymentState === 'confirmed' || paymentState === 'completed'
    const showBanner = booked === '1' && paymentState === 'confirmed'
    const canCancel = paymentState === 'confirmed' && !hasEnded

    return (
        <div className="min-h-screen bg-[#152110] py-24 px-4 md:px-8">
            <div className="max-w-3xl mx-auto space-y-6">

                {showBanner && (
                    <div className="text-center mb-2">
                        <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Check className="w-8 h-8 text-gray-800" strokeWidth={3} />
                        </div>
                        <h1 className="text-3xl font-bold text-white">You're all set!</h1>
                        <p className="text-gray-300 mt-2">
                            Confirmation details have been sent to your email.
                        </p>
                    </div>
                )}

                {/* Car + status */}
                <div className="bg-gray-200 border border-gray-800 rounded-2xl p-6">
                    <div className="flex flex-col sm:flex-row gap-5">
                        <img
                            src={`https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${car.id}/main.PNG`}
                            alt={`${car.year} ${car.make} ${car.model}`}
                            className="w-full sm:w-48 h-32 object-cover rounded-xl border border-black flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start gap-3">
                                {!showBanner ? (
                                    <h1 className="text-2xl font-bold text-black">
                                        {car.year} {car.make} {car.model}
                                    </h1>
                                ) : (
                                    <h2 className="text-2xl font-bold text-black">
                                        {car.year} {car.make} {car.model}
                                    </h2>
                                )}
                                <span
                                    className={`text-xs font-bold px-3 py-1 rounded-full shrink-0 ${
                                        STATUS_BADGE[booking.status] ?? 'bg-gray-800 text-gray-400'
                                    }`}
                                >
                                    {booking.status.toUpperCase()}
                                </span>
                            </div>
                            <Link
                                to="/fleet/$carId"
                                params={{ carId: car.id.toString() }}
                                className="text-sm font-semibold text-emerald-700 hover:underline"
                            >
                                View car details
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Dates and pickup */}
                <div className="bg-gray-200 border border-gray-800 rounded-2xl p-6 space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Pickup</h3>
                            <p className="text-lg font-bold text-black mt-1">
                                {formatBusinessDate(booking.start_time, DATE_FORMAT)}
                            </p>
                            <p className="text-sm text-gray-700">
                                {formatBusinessTime(booking.start_time)} CST
                            </p>
                        </div>
                        <div>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Return</h3>
                            <p className="text-lg font-bold text-black mt-1">
                                {formatBusinessDate(booking.end_time, DATE_FORMAT)}
                            </p>
                            <p className="text-sm text-gray-700">
                                {formatBusinessTime(booking.end_time)} CST
                            </p>
                        </div>
                    </div>

                    <hr className="border-gray-400" />

                    <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-black mb-2">
                            Where to pick it up
                        </h3>
                        <PickupLine pickupLocation={booking.pickup_location} />
                    </div>
                </div>

                {/* Countdown. Only meaningful while the trip is actually going to
                    happen — a canceled booking counting down to its pickup would
                    be nonsense. */}
                {isPaid && !hasEnded && (
                    <div className="bg-gray-200 border border-gray-800 rounded-2xl p-6">
                        <p className="text-black">
                            {hasStarted ? (
                                <>Your trip ends in{' '}
                                    <span className="font-bold">{getRelativeTimeString(endDate, now)}</span>.
                                </>
                            ) : (
                                <>Your trip starts in{' '}
                                    <span className="font-bold">{getRelativeTimeString(startDate, now)}</span>.
                                </>
                            )}
                        </p>
                        <p className="text-sm text-gray-700 mt-2">
                            {hasStarted
                                ? 'Take photos of the car before you hand it back — they’re your record of how you returned it.'
                                : 'Bring your driver’s license. Take a few photos of the car when you pick it up, so its condition at handover is on record.'}
                        </p>
                    </div>
                )}

                {/* Photos. Available regardless of payment state — a guest sorting
                    out a disputed charge still needs to show what the car looked
                    like. */}
                <div className="bg-gray-200 border border-gray-800 rounded-2xl p-6 flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-black">
                            Trip photos{mediaCount > 0 && ` (${mediaCount})`}
                        </h3>
                        <p className="text-sm text-gray-700 mt-1">
                            Photos and videos of the car, shared with BlueFin.
                        </p>
                    </div>
                    <Link
                        to="/trips/$bookingId/photos"
                        params={{ bookingId: booking.id }}
                        className="shrink-0 text-sm font-semibold text-emerald-700 hover:underline"
                    >
                        {mediaCount > 0 ? 'View and add more' : 'Add photos'}
                    </Link>
                </div>

                <PaymentSection
                    paymentState={paymentState}
                    booking={booking}
                    card={card}
                    onRecheck={() => router.invalidate()}
                />

                {canCancel && <CancelTrip bookingId={booking.id} onCanceled={() => router.invalidate()} />}

                <Link
                    to="/my-bookings"
                    className="block text-center text-gray-200 hover:text-gray-400 text-sm transition-colors pt-2"
                >
                    All my trips →
                </Link>
            </div>
        </div>
    )
}

// Same MSP-vs-everything-else split the admin reservation page uses, so a trip
// reads the same way to both sides.
function PickupLine({ pickupLocation }: { pickupLocation: string }) {
    const isAirport = pickupLocation === 'MSP - Minneapolis, MN'

    return (
        <div className="flex items-center gap-3">
            <div className="p-2 border border-gray-700 rounded-full bg-gray-50 text-gray-700 shrink-0">
                {isAirport ? <Plane size={20} /> : <CarFront size={20} />}
            </div>
            <p className="text-black">
                {isAirport ? 'Minneapolis−Saint Paul International Airport' : pickupLocation}
            </p>
        </div>
    )
}

// Everything the page is allowed to say about money lives here, keyed off the
// state getTripForGuest verified against Stripe rather than off booking.status.
// The page this replaced showed "Total paid" for any row it could load, which
// meant an unpaid pending booking rendered as a completed purchase.
function PaymentSection({
    paymentState,
    booking,
    card,
    onRecheck,
}: {
    paymentState: TripPaymentState
    booking: { id: string; total_price: number; start_time: string; end_time: string; pickup_location: string; car_id: number }
    card: { brand: string | null; last4: string | null; receiptUrl: string | null } | null
    onRecheck: () => void
}) {
    if (paymentState === 'processing') {
        return <ProcessingPayment onRecheck={onRecheck} />
    }

    if (paymentState === 'unpaid') {
        return (
            <div className="bg-amber-100 border border-amber-700 rounded-2xl p-6">
                <h3 className="font-bold text-black">You haven't finished checking out</h3>
                <p className="text-sm text-gray-800 mt-1">
                    This car isn't reserved yet — the dates are still open to other renters until
                    the payment goes through.
                </p>
                <Link
                    to="/checkout/$carId"
                    params={{ carId: booking.car_id.toString() }}
                    search={buildCheckoutSearch(booking)}
                    className="inline-block mt-4 px-5 py-2.5 bg-[#152110] hover:bg-[#1d2f17] text-white font-bold rounded-xl text-sm transition-colors"
                >
                    Finish checkout →
                </Link>
            </div>
        )
    }

    if (paymentState === 'failed') {
        return (
            <div className="bg-red-50 border border-red-700 rounded-2xl p-6">
                <h3 className="font-bold text-red-900">Payment didn't go through</h3>
                <p className="text-sm text-red-800 mt-1">
                    Nothing was charged and this trip isn't booked. You can start again from the
                    car's page, or get in touch if you think this is wrong.
                </p>
                <Link
                    to="/fleet/$carId"
                    params={{ carId: booking.car_id.toString() }}
                    className="inline-block mt-4 text-sm font-semibold text-red-900 hover:underline"
                >
                    Back to the car →
                </Link>
            </div>
        )
    }

    if (paymentState === 'canceled') {
        return (
            <div className="bg-gray-200 border border-gray-800 rounded-2xl p-6">
                <h3 className="font-bold text-black">This trip was canceled</h3>
                <p className="text-sm text-gray-700 mt-1">
                    Any charge for it has been refunded. Refunds usually land back on the card
                    within 5–10 business days.
                </p>
            </div>
        )
    }

    // confirmed / completed — the only two states allowed to say "paid".
    return (
        <div className="bg-gray-200 border border-gray-800 rounded-2xl p-6 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Receipt</h3>

            <div className="flex justify-between text-sm">
                <span className="text-gray-700">Booking reference</span>
                <span className="text-black font-mono">{booking.id.slice(0, 8).toUpperCase()}</span>
            </div>

            {card?.last4 && (
                <div className="flex justify-between text-sm">
                    <span className="text-gray-700">Paid with</span>
                    <span className="text-black capitalize">
                        {card.brand ?? 'Card'} ···· {card.last4}
                    </span>
                </div>
            )}

            <hr className="border-gray-400" />

            <div className="flex justify-between text-base">
                <span className="font-bold text-black">Total paid</span>
                <span className="font-bold text-black">${booking.total_price}</span>
            </div>

            {card?.receiptUrl && (
                <a
                    href={card.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-sm font-semibold text-emerald-700 hover:underline"
                >
                    View full receipt →
                </a>
            )}
        </div>
    )
}

// Stripe says the payment is still in flight. Re-run the loader on a timer:
// getTripForGuest re-checks the PaymentIntent and flips the row itself, so this
// resolves without waiting on the webhook.
function ProcessingPayment({ onRecheck }: { onRecheck: () => void }) {
    const [attempts, setAttempts] = useState(0)
    const gaveUp = attempts >= PROCESSING_POLL_LIMIT

    useEffect(() => {
        if (gaveUp) return
        const timer = setTimeout(() => {
            setAttempts(current => current + 1)
            onRecheck()
        }, PROCESSING_POLL_MS)
        return () => clearTimeout(timer)
        // onRecheck is router.invalidate, stable for the life of the router.
    }, [attempts, gaveUp, onRecheck])

    return (
        <div className="bg-amber-100 border border-amber-700 rounded-2xl p-6">
            <h3 className="font-bold text-black">
                {gaveUp ? 'This is taking longer than usual' : 'Confirming your payment…'}
            </h3>
            <p className="text-sm text-gray-800 mt-1">
                {gaveUp
                    ? 'Your booking is safe and nothing is lost — it just hasn’t been confirmed yet. Check My Bookings again shortly, or get in touch and we’ll sort it out.'
                    : 'Your bank is still processing this. This page updates on its own — no need to refresh.'}
            </p>
            {gaveUp && (
                <Link to="/contact" className="inline-block mt-4 text-sm font-semibold text-emerald-800 hover:underline">
                    Contact us →
                </Link>
            )}
        </div>
    )
}

// Two-step confirm rather than a window.confirm, matching the pattern on the
// my-bookings card and the admin reservation page.
function CancelTrip({ bookingId, onCanceled }: { bookingId: string; onCanceled: () => void }) {
    const [asking, setAsking] = useState(false)
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleCancel = async () => {
        setWorking(true)
        setError(null)
        try {
            await cancelBooking({ data: { bookingId } })
            onCanceled()
        } catch {
            setError('Could not cancel this trip. Please contact us.')
            setWorking(false)
            setAsking(false)
        }
    }

    return (
        <div className="bg-gray-200 border border-gray-800 rounded-2xl p-6">
            {!asking ? (
                <button
                    onClick={() => setAsking(true)}
                    className="text-sm font-bold text-red-700 hover:text-red-500 transition-colors cursor-pointer"
                >
                    Cancel this trip
                </button>
            ) : (
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-black">
                        Cancel this trip and refund the full amount?
                    </span>
                    <button
                        onClick={handleCancel}
                        disabled={working}
                        className="text-sm text-black bg-red-700/80 px-3 py-1 rounded-md hover:bg-red-500 border border-black disabled:opacity-50 cursor-pointer"
                    >
                        {working ? '...' : 'Yes, cancel'}
                    </button>
                    <button
                        onClick={() => setAsking(false)}
                        className="text-xs text-black hover:text-gray-700 cursor-pointer"
                    >
                        Keep it
                    </button>
                </div>
            )}
            {error && <p className="text-sm text-red-800 mt-3">{error}</p>}
        </div>
    )
}