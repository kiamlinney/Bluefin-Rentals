import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { getBookingById } from '@/lib/db'

export const Route = createFileRoute('/booking-confirmed')({
    // validateSearch ensures the bookingId param is always a string.
    // If someone navigates here without it, TanStack throws a proper error
    // rather than silently passing undefined to the loader.
    validateSearch: z.object({
        bookingId: z.string(),
    }),
    loader: async ({ location }) => {
        // TanStack may not strongly type `location.search` here, so cast to our validated shape
        const search = location.search as { bookingId: string }
        const booking = await getBookingById({
            data: search.bookingId,
        })
        return { booking }
    },
    component: BookingConfirmed,
})

function BookingConfirmed() {
    const { booking } = Route.useLoaderData()
    // cars(*) in the select query returns the full car row nested here
    const car = booking.cars

    const startDate = new Date(booking.start_time).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    })
    const endDate = new Date(booking.end_time).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    })
    const startTime = new Date(booking.start_time).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
    })
    const endTime = new Date(booking.end_time).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
    })

    return (
        <div className="min-h-screen bg-[#152110] flex items-center justify-center py-12 px-4">
            <div className="max-w-lg w-full">

                {/* Success header */}
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h1 className="text-3xl font-bold text-white">You're all set!</h1>
                    <p className="text-gray-300 mt-2">
                        Confirmation details have been sent to your email.
                    </p>
                </div>

                {/* Booking details card */}
                <div className="bg-gray-200 border border-[#2a4a1e] rounded-2xl p-6 mb-6">

                    {/* Car summary */}
                    <div className="flex gap-4 items-center mb-5 pb-5 border-b border-[#2a4a1e]">
                        <img
                            src={`https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${car.id}/main.PNG`}
                            alt={`${car.year} ${car.make} ${car.model}`}
                            className="w-20 h-14 object-cover rounded-lg flex-shrink-0"
                        />
                        <div>
                            <p className="font-bold text-black">{car.year} {car.make} {car.model}</p>
                            <p className="text-gray-700 text-sm">${car.price_per_day}/day</p>
                        </div>
                    </div>

                    {/* Trip details */}
                    <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                            <span className="font-bold text-black">Pickup</span>
                            <span className="text-black text-right">
                                {startDate}<br />
                                <span className="text-gray-700">{startTime} CST</span>
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="font-bold text-black">Return</span>
                            <span className="text-black text-right">
                                {endDate}<br />
                                <span className="text-gray-700">{endTime} CST</span>
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="font-bold text-black">Location</span>
                            <span className="text-black">{booking.pickup_location}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="font-bold text-black">Booking ID</span>
                            {/* Truncate the UUID to first 8 chars for readability */}
                            <span className="text-black font-mono text-xs">
                                {booking.id.slice(0, 8).toUpperCase()}
                            </span>
                        </div>

                        <hr className="border-[#2a4a1e]" />

                        <div className="flex justify-between text-base">
                            <span className="font-bold text-black">Total paid</span>
                            <span className="text-black">${booking.total_price}</span>
                        </div>
                    </div>
                </div>

                <Link
                    to="/my-bookings"
                    className="block text-center text-gray-200 hover:text-gray-400 text-sm transition-colors"
                >
                    View bookings →
                </Link>
            </div>
        </div>
    )
}