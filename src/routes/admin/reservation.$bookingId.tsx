import {createFileRoute, Link} from '@tanstack/react-router'
import {cancelBooking, getBookingById} from "@/lib/db.ts";
import { Plane, CarFront, Check, X} from 'lucide-react';
import {useState} from "react";

export const Route = createFileRoute('/admin/reservation/$bookingId')({
    loader: async ({ params }) => {
        const booking = await getBookingById({ data: params.bookingId })
        return { booking }
    },
    component: ReservationDetailsPage,
})

function getRelativeTimeString(target: Date, now: Date): string {
    const diffMs = target.getTime() - now.getTime() // difference in milliseconds

    // Target is in the past relative to now
    if (diffMs <= 0) return 'now'

    const totalMinutes = Math.floor(diffMs / (1000 * 60))
    const days = Math.floor(totalMinutes / (60 * 24))
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
    const minutes = totalMinutes % 60

    if (days > 0) {
        return `${days} day${days !== 1 ? 's' : ''}${hours > 0 ? ` and ${hours} hour${hours !== 1 ? 's' : ''}` : ''}`
    }
    if (hours > 0) {
        return `${hours} hour${hours !== 1 ? 's' : ''}${minutes > 0 ? ` and ${minutes} minute${minutes !== 1 ? 's' : ''}` : ''}`
    }
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`
}

function ReservationDetailsPage() {
    const { booking } = Route.useLoaderData()
    const car = booking.cars
    const profile = booking.profiles
    const renterName = profile?.full_name

    const isPastTrip = booking.status === 'completed' || booking.status === 'canceled'

    const now = new Date()
    const startDate = new Date(booking.start_time)
    const endDate = new Date(booking.end_time)

    const createdAt = new Date(profile.created_at)
    const numberFormatted = (profile.phone.slice(0,3).toString() + '-' + profile.phone.slice(3,6).toString() + '-' + profile.phone.slice(6,10).toString())

    const formatTime = (date: Date): string =>
        date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
        })

    const formatDate = (date: Date): string =>
        date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
        })

    const formatDateYear = (date: Date): string =>
        date.toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
        })

    const startsIn = getRelativeTimeString(startDate, now)
    const endsIn = getRelativeTimeString(endDate, now)

    const hasStarted = now >= startDate
    const hasEnded = now >= endDate

    const [initialCancel, setInitialCancel] = useState(false)
    const [confirmCancel, setConfirmCancel] = useState(false)

    const handleCancel = async () => {
        setConfirmCancel(true);
        try {
            await cancelBooking({
                data: {
                    bookingId: booking.id,
                    paymentIntentId: booking.stripe_payment_intent_id,
                }
            });
            window.location.reload(); // Refreshing page
        } catch (err) {
            alert("Failed to cancel trip. Please contact support.");
            setConfirmCancel(false);
        } finally {
            setConfirmCancel(false);
        }
    }

    return (
        <div className="min-h-screen py-16 px-4 md:px-8">
            <div className="max-w-5xl mx-auto">

                {/* Car Title & Thumbnail Grid Header */}
                <header className="flex justify-between items-start border-b border-gray-300 pb-4 mb-8">
                    <div>
                        <h1 className="mb-6 text-4xl text-black tracking-tight font-bold">
                            {isPastTrip ? 'Past trip' : 'Booked trip'}
                        </h1>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                        <div>
                            <h2 className="text-s font-semibold text-gray-800">
                                {car.year} {car.make} {car.model}
                            </h2>
                            <Link
                                to="/fleet/$carId"
                                params={{ carId: car.id.toString() }}
                                className="text-s font-semibold text-emerald-700 hover:underline cursor-pointer">
                                View car details
                            </Link>
                        </div>
                        <img
                            src={`https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${car.id}/main.PNG`}
                            alt={`${car.year} ${car.make} ${car.model}`}
                            className="w-28 h-18 object-cover rounded-md border border-gray-100 shrink-0"
                        />
                    </div>
                </header>

                {/* The Two Columns */}
                {/* In large screens, right column takes up 360px, left column takes up the rest, (1 fractional unit) */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12 items-start">

                    {/* LEFT COLUMN, 1fr width */}
                    <div className="space-y-8">
                        {/* Date/Time Banner */}
                        <section className="flex items-center gap-6 border-b border-gray-200 pb-6">
                            <div>
                                <span className="text-xs font-bold uppercase tracking-wider text-black">
                                    {renterName?.split(' ')[0]}'s Trip
                                </span>
                                <div className="text-lg font-bold mt-0.5">{formatDate(startDate)}</div>
                                <div className="text-sm text-gray-500">{formatTime(startDate)}</div>
                            </div>
                            <div className="h-0.5 w-8 bg-gray-400 " />
                            <div>
                                <span className="text-xs font-bold uppercase tracking-wider text-gray-400 invisible">
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
                                    <div className="flex items-center gap-2">
                                        <div className="p-2 border border-gray-700 rounded-full bg-gray-50 text-gray-700">
                                            <CarFront size={20}/>
                                        </div>
                                        <p>{booking.pickup_location}</p>
                                    </div>
                                )}

                            </div>
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Total Earnings</h3>
                            <p className="text-lg text-gray-500">${booking.total_price}</p>
                            <button className="text-sm font-semibold text-emerald-700 hover:underline cursor-pointer block pt-1">
                                View detailed receipt
                            </button>
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Total Miles Included</h3>
                            <p className="text-lg text-gray-500">- -</p>
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Miles Driven</h3>
                            {booking.miles_driven ? (
                                <p className="text-lg text-gray-500">{booking.miles_driven}</p>
                            ) : (
                                <p className="text-lg text-gray-500">- -</p>
                            )}
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Cancellation Policy</h3>
                            <p className="text-lg text-gray-500">- -</p>
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Vehicle Documents</h3>
                            <p className="text-lg text-gray-500">- -</p>
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Trip Photos</h3>
                            <p className="text-lg text-gray-500">- -</p>
                        </section>

                        <section className="space-y-1">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-black">Additional Drivers</h3>
                            <p className="text-lg text-gray-500">- -</p>
                        </section>
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
                                            <div className="flex items-center gap-3 rounded-lg">
                                                <span className="text-s text-black">Are you sure?</span>
                                                <button
                                                    onClick={handleCancel}
                                                    disabled={confirmCancel}
                                                    className="text-s text-black bg-red-700/80 px-3 py-1 rounded-md hover:bg-red-500 border border-black disabled:opacity-50 cursor-pointer"
                                                >
                                                    {confirmCancel ? '...' : 'Yes'}
                                                </button>
                                                <button
                                                    onClick={() => setInitialCancel(false)}
                                                    className="text-xs text-black hover:text-gray-700 cursor-pointer"
                                                >
                                                    Back
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                </div>
                            )}

                        </div>

                        {/* Renter Profile */}
                        <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-lg">
                                    {renterName[0]?.toUpperCase() ?? 'G'}
                                </div>
                                <div>
                                    <h4 className="font-bold text-gray-900">{renterName}</h4>
                                    {profile.num_trips > 0 && (
                                        <p className="text-s text-gray-500">{profile.num_trips} trips</p>
                                    )}
                                    <p className="text-s text-gray-500">Joined {formatDateYear(createdAt)}</p>
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
                                        {profile.phone ? `+ 1 ${numberFormatted}` : 'Not provided'}
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
                    </div>

                </div>


            </div>
        </div>
    )
}