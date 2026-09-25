import {createFileRoute, Link, useRouter} from '@tanstack/react-router'
import {cancelBooking, getAdditionalDrivers, getBookingById, getCarPriceOverrides, getTripExtras, getTripLockboxCode} from "@/lib/db.ts";
import {AdditionalDriversSection} from "@/components/trip/AdditionalDriversSection";
import {TripExtrasSection} from "@/components/trip/TripExtrasSection";
import {TripMessages} from "@/components/trip/TripMessages";
import {
    businessDateKey,
    businessWallClockTime,
    formatBusinessDate,
    formatBusinessDateTime,
    formatBusinessTime,
    getRelativeTimeString,
} from "@/lib/dates.ts";
import {bookingRateLabel} from "@/lib/booking-rate.ts";
import {effectiveFreeCancellationDeadline} from "@/lib/cancellation-policy.ts";
import { Plane, CarFront, Check, X} from 'lucide-react';
import {useState} from "react";
import {displayName, firstName, formatPhone} from "@/lib/profile.ts";
import {carMainImageUrl} from "@/lib/car-images.ts";
import {carSlug} from "@/lib/slug.ts";
import {buildOverrideMap, calculateTripPrice} from "@/lib/pricing.ts";
import {calculateOverage, distanceFeeForTrip, formatMiles, milesIncluded} from "@/lib/distance.ts";
import {hasUnlimitedMileage} from "@/lib/extras.ts";
import {buildReceipt} from "@/lib/receipt.ts";
import {money} from "@/lib/email-template.ts";

export const Route = createFileRoute('/admin/reservation/$bookingId')({
    loader: async ({ params }) => {
        const booking = await getBookingById({ data: params.bookingId })
        // Sequential rather than a Promise.all: the car id only exists once the
        // booking has come back. Needed because the mileage rate is derived from
        // the trip's average daily price, which is override-dependent.
        const priceOverrides = await getCarPriceOverrides({ data: String(booking.cars.id) })
        const drivers = await getAdditionalDrivers({ data: params.bookingId })
        const lockboxCode = await getTripLockboxCode({ data: params.bookingId })
        const extras = await getTripExtras({ data: params.bookingId })
        return { booking, priceOverrides, drivers, lockboxCode, extras }
    },
    component: ReservationDetailsPage,
})

function ReservationDetailsPage() {
    const { booking, priceOverrides, drivers, lockboxCode, extras } = Route.useLoaderData()
    const car = booking.cars
    const profile = booking.profiles
    // Shared with the trip list and the profile pages, so the same renter reads
    // the same way everywhere.
    const renterName = displayName(profile)

    const isPastTrip = booking.status === 'completed' || booking.status === 'canceled'

    // getBookingById selects trip_media(count), which Supabase returns as a
    // one-element array of aggregates.
    const mediaCount = booking.trip_media?.[0]?.count ?? 0

    const now = new Date()
    const startDate = new Date(booking.start_time)
    const endDate = new Date(booking.end_time)

    // profiles.created_at is nullable, unlike bookings.created_at.
    const createdAt = profile.created_at ? new Date(profile.created_at) : null

    // ── Mileage ──────────────────────────────────────────────────────────────
    // The rate falls with trip length (src/lib/distance.ts), so this needs the
    // trip's quote, not just its dates — and the quote it needs is the one the
    // guest was actually charged against.
    //
    // buildReceipt reads that off bookings.price_quote, which is also what the
    // receipt page prints. Recomputing here instead would price the trip against
    // *today's* per-day overrides, so editing a September price in the calendar
    // would change the allowance shown for a trip that was booked in August —
    // and this page and the receipt it links to would disagree about the same
    // trip.
    const receipt = buildReceipt(booking, car)

    // Only for bookings predating the price_quote column, which have no snapshot
    // to read. Recomputing is wrong in principle and right in practice here: the
    // alternative for a legacy row is no mileage figure at all.
    //
    // The stored timestamps are UTC instants and calculateTripPrice wants
    // wall-clock strings, so they go through businessDateKey/businessWallClockTime
    // — the same pair buildCheckoutSearch uses, for the same reason. Slicing the
    // ISO string would take the *UTC* day, which is the next day for a
    // late-evening Central return and would bill an extra 200 miles.
    //
    // No pickup fee: it doesn't enter the ratio, and the row stores only the
    // rendered location string so the selection can't be reconstructed anyway
    // (see the known gap in src/lib/checkout-search.ts).
    const fallbackQuote = receipt.quote
        ? null
        : calculateTripPrice({
            startDate: businessDateKey(startDate),
            startTime: businessWallClockTime(startDate),
            endDate: businessDateKey(endDate),
            endTime: businessWallClockTime(endDate),
            basePricePerDay: Number(car.price_per_day),
            overrides: buildOverrideMap(priceOverrides),
        })

    // What the guest was told about cancelling — and, since cancelBooking now
    // enforces the policy, also the rule it applies. effectiveFreeCancellation-
    // Deadline rather than freeCancellationDeadline: the raw helper doesn't
    // know about the late-booking grace or the cap that keeps non-refundable
    // from outlasting refundable, so on a short-lead booking it would show a
    // later deadline than the one actually enforced.
    const cancelDeadline = effectiveFreeCancellationDeadline(booking.booking_rate, {
        bookedAt: new Date(booking.created_at),
        tripStart: startDate,
    })

    const totalMilesIncluded = fallbackQuote
        ? milesIncluded(fallbackQuote.billableDays)
        : receipt.milesIncluded
    const perMileFee = fallbackQuote
        ? distanceFeeForTrip(car, fallbackQuote, Number(car.price_per_day))
        : receipt.perMileFee
    // An unlimited-mileage trip has no allowance to exceed, so there is nothing
    // to charge however far it was driven. Zeroed here rather than hidden at
    // render, so no figure exists to be read off the page and billed by hand.
    const unlimitedMiles = hasUnlimitedMileage(receipt.quote)
    const overage = unlimitedMiles
        ? { milesOver: 0, amount: 0 }
        : calculateOverage(booking.miles_driven ?? 0, totalMilesIncluded, perMileFee)

    // The phone column is nullable and free-form — it's whatever the renter typed,
    // so it isn't guaranteed to be 10 digits. The old version sliced blindly,
    // which turned a 7-digit or already-formatted number into nonsense like
    // "555-123-" rather than just showing what was stored.
    const numberFormatted = formatPhone(profile.phone)

    const formatTime = (date: Date): string => formatBusinessTime(date)

    const formatDate = (date: Date): string =>
        formatBusinessDate(date, { weekday: 'long', month: 'long', day: 'numeric' })

    const formatDateYear = (date: Date): string =>
        formatBusinessDate(date, { month: 'long', year: 'numeric' })

    const startsIn = getRelativeTimeString(startDate, now)
    const endsIn = getRelativeTimeString(endDate, now)

    const hasStarted = now >= startDate
    const hasEnded = now >= endDate

    const router = useRouter()

    const [initialCancel, setInitialCancel] = useState(false)
    const [confirmCancel, setConfirmCancel] = useState(false)
    const [cancelError, setCancelError] = useState<string | null>(null)

    const handleCancel = async () => {
        setConfirmCancel(true)
        setCancelError(null)
        try {
            await cancelBooking({ data: { bookingId: booking.id } })
            // invalidate() rather than the full reload this used to do: the
            // loader refetches and the page re-renders in place, keeping scroll
            // position. Same change the guest cancel flow made.
            await router.invalidate()
            setInitialCancel(false)
        } catch (err: unknown) {
            // Shown on the page rather than in an alert(). cancelBooking's
            // errors are specific — "could not process refund through Stripe,
            // nothing was changed" is actionable, and a generic alert threw
            // that away.
            setCancelError(err instanceof Error ? err.message : 'Could not cancel this trip.')
        } finally {
            setConfirmCancel(false)
        }
    }

    return (
        <div className="py-8 md:py-16 px-4 md:px-8">
            <div className="max-w-5xl mx-auto">

                {/* Car Title & Thumbnail Grid Header - stacked on phones, car info above the title */}
                <header className="flex flex-col-reverse gap-4 sm:flex-row sm:justify-between sm:items-start border-b border-gray-300 pb-4 mb-8">
                    <div>
                        <h1 className="sm:mb-6 text-3xl sm:text-4xl text-black tracking-tight font-bold">
                            {isPastTrip ? 'Past trip' : 'Booked trip'}
                        </h1>
                    </div>
                    <div className="flex flex-row-reverse sm:flex-row items-center justify-end gap-3 sm:text-right">
                        <div>
                            <h2 className="text-s font-semibold text-gray-800">
                                {car.make} {car.model} {car.year}
                            </h2>
                            <Link
                                to="/fleet/$carSlug"
                                params={{ carSlug: carSlug(car) }}
                                className="text-s font-semibold text-emerald-700 hover:underline cursor-pointer">
                                View car details
                            </Link>
                        </div>
                        <img
                            src={carMainImageUrl(car.id)}
                            alt={`${car.make} ${car.model} ${car.year}`}
                            className="w-28 h-18 object-cover rounded-md border border-gray-100 shrink-0"
                            decoding="async"
                        />
                    </div>
                </header>

                {/* The Two Columns */}
                {/* In large screens, right column takes up 360px, left column takes up the rest, (1 fractional unit) */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12 items-start">

                    {/* LEFT COLUMN, 1fr width */}
                    <div className="space-y-8">
                        {/* Date/Time Banner */}
                        <section className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-6 border-b border-gray-200 pb-6">
                            <div>
                                <span className="text-xs font-bold uppercase tracking-wider text-black">
                                    {renterName?.split(' ')[0]}'s Trip
                                </span>
                                <div className="text-lg font-bold mt-0.5">{formatDate(startDate)}</div>
                                <div className="text-sm text-gray-500">{formatTime(startDate)}</div>
                            </div>
                            {/* Dash and spacer label only line up when the dates sit side by side */}
                            <div className="hidden sm:block h-0.5 w-8 bg-gray-400 " />
                            <div>
                                <span className="hidden sm:inline text-xs font-bold uppercase tracking-wider text-gray-400 invisible">
                                    End
                                </span>
                                <div className="text-lg font-bold mt-0.5">{formatDate(endDate)}</div>
                                <div className="text-sm text-gray-500">{formatTime(endDate)}</div>
                            </div>
                        </section>

                        {/* Location Panel */}
                        <section className="space-y-2">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Location</h3>
                            <div className="flex items-center gap-3 text-sm text-gray-500">
                                {booking.pickup_location === 'MSP - Minneapolis, MN' ? (
                                    <div className="flex items-center gap-2">
                                        <div className="p-2 border border-gray-700 rounded-full bg-gray-50 text-gray-700">
                                            <Plane size={20}/>
                                        </div>
                                        <p>Minneapolis−Saint Paul International Airport</p>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-gray-800">
                                        <div className="p-2 border border-gray-700 rounded-full bg-gray-50">
                                            <CarFront size={20}/>
                                        </div>
                                        <p>{booking.pickup_location}</p>
                                    </div>
                                )}

                            </div>
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Total Earnings</h3>
                            <p className="text-lg text-gray-700">{money(booking.total_price)}</p>
                            <Link
                                to="/trips/$bookingId/receipt"
                                params={{ bookingId: booking.id }}
                                className="text-sm font-semibold text-emerald-700 hover:underline cursor-pointer block pt-1"
                            >
                                View detailed receipt
                            </Link>
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Total Miles Included</h3>
                            <p className="text-lg text-gray-700">
                                {unlimitedMiles ? 'Unlimited' : `${formatMiles(totalMilesIncluded)} miles`}
                            </p>
                            <p className="text-sm text-gray-500 max-w-md">
                                {unlimitedMiles ? (
                                    <>
                                        {renterName?.split(' ')[0]} added unlimited mileage to this trip.
                                        No per-mile charge applies, however far it was driven.
                                    </>
                                ) : (
                                    <>
                                        {renterName?.split(' ')[0]} can be charged ${perMileFee.toFixed(2)} for every mile
                                        over the total included for the trip.
                                    </>
                                )}
                            </p>
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Miles Driven</h3>
                            {/* Still dashes until the odometer flow that writes
                                miles_driven exists. */}
                            {booking.miles_driven ? (
                                <p className="text-lg text-gray-500">{formatMiles(booking.miles_driven)} miles</p>
                            ) : (
                                <p className="text-lg text-gray-500">- -</p>
                            )}
                            {/* Only when there is one — a "0 miles over" line is noise. */}
                            {overage.milesOver > 0 && (
                                <p className="text-sm font-semibold text-amber-700">
                                    {formatMiles(overage.milesOver)} miles over · ${overage.amount.toFixed(2)} due
                                </p>
                            )}
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Cancellation Policy</h3>
                            <p className="text-lg text-gray-700">{bookingRateLabel(booking.booking_rate)}</p>
                            {/* The deadline is stated as a datetime rather than
                                "24 hours after booking", because it isn't always
                                24 hours: a trip booked close to its own start
                                gets a shorter window, and non-refundable is
                                capped so it can't outlast refundable. */}
                            <p className="text-sm text-gray-500 max-w-md">
                                {new Date() < cancelDeadline
                                    ? `Free cancellation until ${formatBusinessDateTime(cancelDeadline)}.`
                                    : `Free cancellation ended ${formatBusinessDateTime(cancelDeadline)}.`}
                                {booking.booking_rate === 'refundable'
                                    ? ' After that, a cancellation fee of one day (or half a day on trips of two days or less) is retained.'
                                    : ' After that, no refund is issued.'}
                            </p>
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Vehicle Documents</h3>
                            <p className="text-lg text-gray-500">- -</p>
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">
                                Trip Photos{mediaCount > 0 && ` (${mediaCount})`}
                            </h3>
                            {/* Guest and host share one photos page now; the
                                back link there points wherever the viewer came
                                from. */}
                            <Link
                                to="/trips/$bookingId/photos"
                                params={{ bookingId: booking.id }}
                                className="text-sm font-semibold text-emerald-700 hover:underline cursor-pointer block pt-1"
                            >
                                {mediaCount > 0 ? 'View and add more' : 'Add photos'}
                            </Link>
                        </section>

                        {/* The rest of this column is the guest page's own
                            components, so the two sides cannot disagree about
                            what is on a trip. voice="host" swaps the copy and
                            drops the controls the guest owns. They re-theme to
                            the admin greys on their own — .admin-shell
                            redefines the semantic colour tokens. */}
                        <TripExtrasSection
                            bookingId={booking.id}
                            extras={extras}
                            voice="host"
                            canRequestMore={false}
                        />

                        <AdditionalDriversSection
                            bookingId={booking.id}
                            drivers={drivers}
                            voice="host"
                            canManage={false}
                        />

                        {/* The exact message the guest was sent on booking,
                            lockbox code included — so when they call about it,
                            the answer is on screen rather than in an inbox. */}
                        {booking.status === 'confirmed' && (
                            <TripMessages
                                guestFirstName={firstName(profile)}
                                lockboxCode={lockboxCode}
                                sentAt={booking.created_at}
                            />
                        )}
                    </div>

                    {/* RIGHT COLUMN, 360px width*/}
                    <div className="lg:sticky lg:top-6 space-y-6">

                        {/* Countdown Banner */}
                        <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm space-y-4">
                            {hasEnded ? (
                                <button className="w-full py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer">
                                    Charge for incidentals
                                </button>
                            ) : hasStarted ? (
                                <p className="text-sm text-gray-700 leading-relaxed">
                                    This trip ends in <span className="font-semibold">{endsIn}.</span>
                                </p>
                            ) : (
                                <div className="flex flex-col gap-y-2">
                                    <p className="text-sm text-gray-700 leading-relaxed">
                                        This trip starts in <span className="font-semibold">{startsIn}.</span>
                                    </p>
                                    <button className="w-full py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer">
                                        Swap vehicle
                                    </button>
                                    <div className="flex flex-col items-end">
                                        {!initialCancel ? (
                                            <button
                                                onClick={() => setInitialCancel(true)}
                                                className="w-full py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                                            >
                                                Cancel Trip
                                            </button>
                                        ) : (
                                            <div className="flex flex-col items-end gap-2 w-full">
                                                {/* Two genuinely different actions behind one
                                                    button, so the copy has to say which one is
                                                    about to happen.

                                                    A confirmed trip: a host cancellation always
                                                    refunds in full. The guest's rate and free
                                                    window govern what *they* get back when *they*
                                                    cancel, and neither applies when the decision
                                                    is ours — worth spelling out, since a
                                                    non-refundable policy is shown right above.

                                                    A pending hold: never charged, so there is
                                                    nothing to refund and nobody is emailed. It
                                                    is marked expired rather than canceled and
                                                    drops off the guest's trip list. Saying
                                                    "refund in full" here would promise money
                                                    that was never taken. */}
                                                <span className="text-xs text-gray-700 text-right">
                                                    {booking.status === 'pending' ? (
                                                        <>
                                                            Discard this unpaid hold? Nothing was charged,
                                                            so nothing is refunded and the guest is not
                                                            emailed. The dates go back on sale.
                                                        </>
                                                    ) : (
                                                        <>
                                                            Cancel and refund the guest{' '}
                                                            <strong>{money(booking.total_price)}</strong> in full?
                                                            This ignores the {bookingRateLabel(booking.booking_rate).toLowerCase()} policy,
                                                            and emails both of you.
                                                        </>
                                                    )}
                                                </span>
                                                {cancelError && (
                                                    <span className="text-xs text-red-700 text-right">{cancelError}</span>
                                                )}
                                                <div className="flex items-center gap-3">
                                                    <button
                                                        onClick={handleCancel}
                                                        disabled={confirmCancel}
                                                        className="text-s text-black bg-red-700/80 px-3 py-1 rounded-md hover:bg-red-500 border border-black disabled:opacity-50 cursor-pointer"
                                                    >
                                                        {confirmCancel
                                                            ? '...'
                                                            : booking.status === 'pending' ? 'Discard' : 'Yes'}
                                                    </button>
                                                    <button
                                                        onClick={() => setInitialCancel(false)}
                                                        className="text-xs text-black hover:text-gray-700 cursor-pointer"
                                                    >
                                                        Back
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                </div>
                            )}

                        </div>

                        {/* Renter Profile */}
                        <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm space-y-4">
                            <div className="flex items-center gap-3">
                                {/* Avatar and name link separately rather than
                                    wrapping the whole block, so the trips and
                                    joined lines stay non-interactive. */}
                                <Link
                                    to="/admin/user/$userId"
                                    params={{ userId: profile.id }}
                                    className="w-12 h-12 shrink-0 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center text-gray-500 font-bold text-lg"
                                >
                                    {renterName[0]?.toUpperCase() ?? 'G'}
                                </Link>
                                <div>
                                    <Link
                                        to="/admin/user/$userId"
                                        params={{ userId: profile.id }}
                                        className="font-bold text-gray-900 hover:underline"
                                    >
                                        {renterName}
                                    </Link>
                                    {(profile.num_trips ?? 0) > 0 && (
                                        <p className="text-s text-gray-500">{profile.num_trips} trips</p>
                                    )}
                                    {createdAt && (
                                        <p className="text-s text-gray-500">Joined {formatDateYear(createdAt)}</p>
                                    )}
                                </div>
                            </div>

                            <hr className="border-gray-100" />

                            {/* Verification Checkmarks Stack */}
                            <div className="space-y-3">
                                <div className="flex justify-between items-center text-sm">

                                    {profile.identity_verified ? (
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-600">Driver's license verified</span>
                                            <span className="text-emerald-700 font-bold"><Check size={16}/></span>
                                            <button className="justify-end text-emerald-700 font-bold cursor-pointer">
                                                View
                                            </button >
                                        </div>

                                    ) : (
                                        <span className="text-red-800 font-bold"><X size={16}/></span>
                                    )}

                                </div>
                                <hr className="border-gray-100" />
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-gray-600">Phone number</span>
                                    <span className="text-emerald-700 cursor-pointer hover:underline">
                                        {numberFormatted ?? 'Not provided'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-gray-600">Email address</span>
                                    <span className="text-emerald-700 cursor-pointer hover:underline">
                                        {profile.email ? profile.email : 'Not provided'}
                                    </span>
                                </div>

                            </div>
                        </div>

                        <p className="text-center text-xs text-black font-semibold uppercase">reservation #{booking.id}</p>
                    </div>

                </div>


            </div>
        </div>
    )
}