import { Link } from "@tanstack/react-router";
import {Car} from "@/types.ts";

export function TripCard({ booking }: { booking: any }) {
    const car: Car = booking.cars

    const now = new Date()
    const startTime = new Date(booking.start_time)
    const endTime = new Date(booking.end_time)

    const isActive = startTime <= now

    const formatTime = (date: Date): string =>
        date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
        })

    const formatDate = (date: Date): string =>
        date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
        })


    let badgeText = ''
    let badgeClass = ''

    const isCanceled = booking.status === 'canceled'
    const isCompleted = booking.status === 'completed'

    if (isCompleted) {
        badgeText = `${formatDate(startTime)} - ${formatDate(endTime)}`

        badgeClass = 'bg-gray-700/20 !text-sm'

    } else if (isCanceled) {
        badgeText = `${formatDate(startTime)} - ${formatDate(endTime)}`

        badgeClass = '!text-sm line-through'

    } else { // Upcoming trip, status of 'confirmed'
        badgeText = isActive
            ? `Ending at ${formatTime(endTime)}`
            : `Starting at ${formatTime(startTime)}`

        badgeClass = isActive
            ? 'bg-red-100 text-red-700'
            : 'bg-green-600/30 text-green-700'
    }



    const profile = booking.profiles
    const renterName = profile?.full_name ?? profile?.email?.split('@')[0] ?? 'Guest'
    const shortBookingId = booking.id.slice(0, 8).toUpperCase()

    return (
        <Link
            to="/admin/reservation/$bookingId"
            params={{ bookingId: booking.id }}
            className={[
                'flex items-start justify-between bg-white border border-gray-200 rounded-lg px-5 py-4 hover:shadow-sm transition-all text-left',
                isCanceled ? '!bg-gray-200' : 'hover:border-gray-300'
            ].join(' ')}        >

            {/* Left: all the text content */}
            <div className="flex flex-col gap-1">
                {/* Badge - sits above the car name */}
                <span className={`text-xs px-2 py-0.5 rounded-sm w-fit ${badgeClass}`}>
                    {badgeText}
                </span>

                <h3 className="text-base font-bold text-black mt-1">
                    {car.make} {car.model} {car.trim} {car.year}
                </h3>

                <p className="flex gap-1 text-sm text-gray-500">
                    {booking.pickup_location}
                </p>

                {/* Renter info */}
                <div className="flex items-center gap-2 mt-1">
                    {isCanceled ? (
                        <span className="text-sm text-gray-500">
                            Canceled by {renterName} #{shortBookingId}
                        </span>
                    ) : (
                        <div className="flex items-center gap-1">
                            <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                                {renterName[0]?.toUpperCase() ?? 'G'}
                            </div>
                            <span className="text-sm text-gray-500">
                                {renterName} #{shortBookingId}
                            </span>
                        </div>
                    )}
                </div>

            </div>

            {/* Right: Car Image */}
            <div className="flex flex-col items-center justify-center">
                <img
                    src={`https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${car.id}/main.PNG`}
                    alt={`${car.year} ${car.make} ${car.model}`}
                    className="w-24 h-16 object-cover rounded-lg flex-shrink-0"
                />

                <p className="text-xs text-gray-600 text-center">
                    {car.license_plate}
                </p>

                {(isCompleted || isCanceled) && (
                    <p className="pt-4 text-xs text-gray-600 text-center">
                        Total Paid: ${booking.total_price}
                    </p>
                )}

            </div>


        </Link>
    )
}