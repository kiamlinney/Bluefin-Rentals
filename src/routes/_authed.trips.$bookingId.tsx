import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import {
    getAdditionalDrivers,
    getBookingReview,
    getTripExtras,
    getTripForGuest,
} from '@/lib/db'
import { ReviewItem } from '@/components/reviews/ReviewList'
import { ReviewDialog } from '@/components/reviews/ReviewDialog'
import { CancelTripDialog } from '@/components/CancelTripDialog'
import { buildReceipt } from '@/lib/receipt'
import { bookingRateLabel } from '@/lib/booking-rate'
import { effectiveFreeCancellationDeadline } from '@/lib/cancellation-policy'
import { hasUnlimitedMileage } from '@/lib/extras'
import { formatMiles } from '@/lib/distance'
import { carSlug } from '@/lib/slug'
import { carMainImageUrl } from '@/lib/car-images'
import { firstName } from '@/lib/profile'
import {
    formatBusinessDateTime,
    getRelativeTimeString,
} from '@/lib/dates'
import { TripSection } from '@/components/trip/TripSection'
import { TripDatesBlock } from '@/components/trip/TripDatesBlock'
import { GetDirectionsLink, TripLocation } from '@/components/trip/TripLocation'
import { TripPaymentSection } from '@/components/trip/TripPaymentSection'
import { AdditionalDriversSection } from '@/components/trip/AdditionalDriversSection'
import { TripExtrasSection } from '@/components/trip/TripExtrasSection'
import { BookedTripModal } from '@/components/trip/BookedTripModal'
import { TripMessages } from '@/components/trip/TripMessages'

// The guest's permanent page for one trip. This replaced /booking-confirmed,
// which was a one-shot receipt with no authorization of its own and no idea
// whether the payment had actually gone through.
//
// Confirmation is a state of this page rather than a page of its own — the same
// URL serves the moment after checkout, the week before pickup, and the year
// after the trip ended. `?booked=1` is what distinguishes "just arrived from
// checkout" from "opened this from My Bookings", and nothing else depends on it.
//
// Laid out as the host's reservation page is, because a guest asking "what did
// I actually book?" wants the same facts the host has. The two share their
// section components; what differs is voice and what each side may do.
export const Route = createFileRoute('/_authed/trips/$bookingId')({
    validateSearch: z.object({
        booked: z.literal('1').optional(),
    }),
    loader: async ({ params }) => {
        const [trip, review, drivers, extras] = await Promise.all([
            getTripForGuest({ data: params.bookingId }),
            getBookingReview({ data: params.bookingId }),
            getAdditionalDrivers({ data: params.bookingId }),
            getTripExtras({ data: params.bookingId }),
        ])
        return { ...trip, review, drivers, extras }
    },
    component: TripPage,
})

const STATUS_BADGE: Record<string, string> = {
    confirmed: 'bg-pine-500/80 text-pine-950',
    canceled: 'bg-red-900/30 text-red-800',
    completed: 'bg-blue-900/30 text-blue-800',
    pending: 'bg-amber-300/60 text-ink',
    // Reachable directly by URL even though the trips list hides these.
    expired: 'bg-cream-200 text-muted',
}

function TripPage() {
    const { booking, paymentState, card, review, isAdmin, drivers, extras, lockboxCode } =
        Route.useLoaderData()
    const { booked } = Route.useSearch()
    const router = useRouter()
    const navigate = useNavigate()

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
    const isCanceled = booking.status === 'canceled'

    const receipt = buildReceipt(booking, car)
    const unlimitedMiles = hasUnlimitedMileage(receipt.quote)

    // Kept on live state rather than stripped on mount, so a guest who arrives
    // while the payment is still `processing` still gets the modal once the
    // poll in TripPaymentSection flips it to confirmed.
    const [modalDismissed, setModalDismissed] = useState(false)
    const showBookedModal = booked === '1' && paymentState === 'confirmed' && !modalDismissed

    const [cancelling, setCancelling] = useState(false)

    const canCancel = booking.status === 'confirmed' && !hasEnded
    const canManageDrivers = booking.status === 'confirmed' && !hasStarted

    const cancelDeadline = effectiveFreeCancellationDeadline(booking.booking_rate, {
        bookedAt: new Date(booking.created_at),
        tripStart: startDate,
    })

    const title = isCanceled ? 'Cancelled trip' : hasEnded ? 'Past trip' : 'Booked trip'

    return (
        // py-24 is navbar clearance on desktop; a phone doesn't need 6rem of it
        // above the fold, so the top padding is halved there.
        <div className="min-h-screen pt-20 pb-16 md:py-24 px-4 md:px-8">
            <div className="max-w-5xl mx-auto">

                {/* ── Header ──────────────────────────────────────────────── */}
                {/* Stacked on a phone: the title and the car name side by side
                    squeezed both into two or three words per line. The thumbnail
                    leads on mobile because it identifies the trip faster than
                    the words do. */}
                <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 pb-5 sm:pb-6 border-b border-line">
                    <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-ink">{title}</h1>

                    <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                        <img
                            src={carMainImageUrl(car.id)}
                            alt={`${car.make} ${car.model} ${car.year}`}
                            className="w-20 h-14 sm:w-28 sm:h-20 object-cover rounded-xl border border-line sm:order-2"
                            decoding="async"
                        />
                        <div className="min-w-0 sm:text-right sm:order-1">
                            <p className="font-semibold text-ink truncate">
                                {car.make} {car.model} {car.year}
                            </p>
                            <Link
                                to="/fleet/$carSlug"
                                params={{ carSlug: carSlug(car) }}
                                className="text-sm font-semibold text-pine-500 hover:underline"
                            >
                                View car details
                            </Link>
                        </div>
                    </div>
                </div>

                {/* The action card comes first on a phone — cancelling, adding
                    extras and the countdown are what someone opens this page
                    for, and burying them under ten reference sections means
                    scrolling past all of it every time. */}
                <div className="grid gap-8 lg:gap-10 lg:grid-cols-[1fr_320px] lg:items-start pt-6 sm:pt-8">

                    {/* ── Left: the trip itself ───────────────────────────── */}
                    <div className="space-y-7 sm:space-y-8 min-w-0 order-2 lg:order-1">

                        <TripSection title="Your trip">
                            <TripDatesBlock
                                start={booking.start_time}
                                end={booking.end_time}
                                struck={isCanceled}
                            />
                        </TripSection>

                        <TripSection
                            title="Location"
                            action={!isCanceled && <GetDirectionsLink pickupLocation={booking.pickup_location} />}
                        >
                            <TripLocation pickupLocation={booking.pickup_location} struck={isCanceled} />
                        </TripSection>

                        <TripSection title="Total miles included">
                            <p className="text-lg text-ink">
                                {unlimitedMiles ? 'Unlimited' : `${formatMiles(receipt.milesIncluded)} miles`}
                            </p>
                            <p className="text-sm text-muted max-w-md">
                                {unlimitedMiles
                                    ? 'You added unlimited mileage to this trip, so there is no per-mile charge however far you drive.'
                                    : `If you exceed ${formatMiles(receipt.milesIncluded)} miles total, you'll be charged $${receipt.perMileFee.toFixed(2)} for each additional mile.`}
                            </p>
                        </TripSection>

                        <TripSection
                            title="Invoices"
                            action={
                                <Link
                                    to="/trips/$bookingId/receipt"
                                    params={{ bookingId: booking.id }}
                                    className="text-sm font-semibold text-pine-500 hover:underline"
                                >
                                    View
                                </Link>
                            }
                        >
                            <p className="text-sm text-muted">
                                A full itemised breakdown of what this trip cost.
                            </p>
                        </TripSection>

                        <TripSection title="Total cost">
                            <p className="text-lg text-ink">${booking.total_price}</p>
                            <Link
                                to="/trips/$bookingId/receipt"
                                params={{ bookingId: booking.id }}
                                className="inline-block text-sm font-semibold text-pine-500 hover:underline"
                            >
                                View detailed receipt
                            </Link>
                        </TripSection>

                        <TripSection
                            title="Cancellation policy"
                            action={
                                <Link
                                    to="/policies/cancellation"
                                    className="text-sm font-semibold text-pine-500 hover:underline"
                                >
                                    Learn more
                                </Link>
                            }
                        >
                            <p className="text-lg text-ink">{bookingRateLabel(booking.booking_rate)}</p>
                            {/* Interpolated from the same helper the checkout
                                page and the policy page use, so the date shown
                                here is the date actually enforced. */}
                            <p className="text-sm text-muted max-w-md">
                                Free cancellation until {formatBusinessDateTime(cancelDeadline)}.
                            </p>
                        </TripSection>

                        {/* Present and deliberately empty: BlueFin has no
                            protection product yet. Worded as a plain statement
                            rather than "coming soon", because a heading with
                            nothing under it on a rental reservation reads as
                            though coverage is included and merely unlisted. */}
                        <TripSection title="Protection options">
                            <p className="text-sm text-muted max-w-md">
                                No protection plan is included with this trip. Your own auto
                                insurance applies as it normally would.
                            </p>
                        </TripSection>

                        <TripSection title="License plate">
                            <p className="text-lg text-ink">{car.license_plate ?? '- -'}</p>
                        </TripSection>

                        <TripSection
                            title={`Trip photos${mediaCount > 0 ? ` (${mediaCount})` : ''}`}
                            action={
                                <Link
                                    to="/trips/$bookingId/photos"
                                    params={{ bookingId: booking.id }}
                                    className="text-sm font-semibold text-pine-500 hover:underline"
                                >
                                    {mediaCount > 0 ? 'View and add more' : 'Add photos'}
                                </Link>
                            }
                        >
                            <p className="text-sm text-muted max-w-md">
                                Photos and videos of the car, shared with Bluefin. Taking a few at
                                pickup and drop-off is your record of its condition.
                            </p>
                        </TripSection>

                        <TripExtrasSection
                            bookingId={booking.id}
                            extras={extras}
                            voice="guest"
                            canRequestMore={isPaid && !hasStarted}
                        />

                        <AdditionalDriversSection
                            bookingId={booking.id}
                            drivers={drivers}
                            voice="guest"
                            canManage={canManageDrivers}
                        />

                        {/* Only once the trip is paid for — the message carries
                            arrival instructions for a car that isn't reserved
                            until then. */}
                        {isPaid && (
                            <TripMessages
                                guestFirstName={firstName(booking.profiles?.full_name ?? null)}
                                lockboxCode={lockboxCode}
                                sentAt={booking.created_at}
                            />
                        )}

                        {booking.status === 'completed' && (
                            <TripReview booking={booking} review={review} isAdmin={isAdmin} />
                        )}
                    </div>

                    {/* ── Right: state and what you can do about it ───────── */}
                    <div className="space-y-5 sm:space-y-6 order-1 lg:order-2 lg:sticky lg:top-6">

                        <div className="bg-surface border border-line rounded-2xl p-5 sm:p-6 space-y-4">
                            <span
                                className={`inline-block text-xs font-bold px-3 py-1 rounded-full ${
                                    STATUS_BADGE[booking.status] ?? 'bg-subtle text-muted'
                                }`}
                            >
                                {booking.status.toUpperCase()}
                            </span>

                            {isCanceled ? (
                                <p className="text-ink">This trip was canceled.</p>
                            ) : isPaid && !hasEnded ? (
                                <>
                                    <p className="text-ink">
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
                                    <p className="text-sm text-muted">
                                        {hasStarted
                                            ? 'Take photos of the car before you hand it back — they’re your record of how you returned it.'
                                            : 'Bring your driver’s license. Take a few photos of the car when you pick it up, so its condition at handover is on record.'}
                                    </p>
                                </>
                            ) : null}

                            {isPaid && !hasStarted && (
                                <Link
                                    to="/trips/$bookingId/extras"
                                    params={{ bookingId: booking.id }}
                                    className="block w-full text-center px-4 py-2.5 rounded-xl border border-line text-ink text-sm font-bold hover:bg-subtle transition-colors"
                                >
                                    Request extras
                                </Link>
                            )}

                            {/* Cancelling lives here now rather than on the
                                my-bookings card: it belongs with the trip it
                                cancels, next to the policy that governs it. */}
                            {canCancel && (
                                <button
                                    type="button"
                                    onClick={() => setCancelling(true)}
                                    className="w-full px-4 py-2.5 rounded-xl border border-line text-red-700 text-sm font-bold hover:bg-red-50 hover:border-red-700 transition-colors cursor-pointer"
                                >
                                    Cancel trip
                                </button>
                            )}
                        </div>

                        <TripPaymentSection
                            paymentState={paymentState}
                            booking={booking}
                            card={card}
                            onRecheck={() => router.invalidate()}
                        />

                        <p className="text-xs font-bold uppercase tracking-wider text-muted">
                            Reservation #{booking.id.slice(0, 8).toUpperCase()}
                        </p>

                        <Link
                            to="/my-bookings"
                            className="block text-muted hover:text-ink text-sm transition-colors"
                        >
                            All my trips →
                        </Link>
                    </div>
                </div>
            </div>

            {showBookedModal && (
                <BookedTripModal
                    car={car}
                    startTime={booking.start_time}
                    endTime={booking.end_time}
                    pickupLocation={booking.pickup_location}
                    onClose={() => {
                        setModalDismissed(true)
                        // Drop the param so a refresh doesn't re-open it. The
                        // local flag above still does the work — this only keeps
                        // the URL honest about what it's showing.
                        void navigate({
                            to: '.',
                            search: ({ booked: _booked, ...rest }) => rest,
                            replace: true,
                        })
                    }}
                />
            )}

            {cancelling && (
                <CancelTripDialog
                    bookingId={booking.id}
                    totalPaid={Number(booking.total_price)}
                    onClose={() => setCancelling(false)}
                    onCanceled={() => {
                        setCancelling(false)
                        router.invalidate()
                    }}
                />
            )}
        </div>
    )
}

type TripData = ReturnType<typeof Route.useLoaderData>

// Completed trips only
function TripReview({
    booking,
    review,
    isAdmin,
}: {
    booking: TripData['booking']
    review: TripData['review']
    isAdmin: boolean
}) {
    const router = useRouter()
    const [writing, setWriting] = useState(false)

    if (review?.removed) {
        return (
            <TripSection title="Your review">
                <p className="text-sm text-muted">This review was removed by Bluefin.</p>
            </TripSection>
        )
    }

    if (review) {
        return (
            <TripSection title={review.is_mine ? 'Your review' : 'Guest review'}>
                <ReviewItem review={review} />
            </TripSection>
        )
    }

    if (isAdmin) return null

    return (
        <TripSection title="How was your trip?">
            <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted">
                    Your review is shown on this car’s page and helps other guests choose.
                </p>
                <button
                    onClick={() => setWriting(true)}
                    className="shrink-0 px-4 py-2 rounded-lg bg-brand text-on-brand text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                >
                    Write a review
                </button>
            </div>

            {writing && (
                <ReviewDialog
                    mode="create"
                    trips={[{
                        id: booking.id,
                        start_time: booking.start_time,
                        end_time: booking.end_time,
                        cars: booking.cars,
                    }]}
                    onClose={() => setWriting(false)}
                    onSaved={async () => {
                        await router.invalidate()
                        setWriting(false)
                    }}
                />
            )}
        </TripSection>
    )
}
