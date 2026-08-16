import {useState} from "react";
import {cancelBooking} from "@/lib/db.ts";
import {businessDateKey, businessWallClockTime} from "@/lib/dates.ts";
import {CalendarDays, MapPin} from "lucide-react";
import {Link} from "@tanstack/react-router";

export function BookingCard({ booking, formatDate, isUpcoming }: { booking: any, formatDate: any, isUpcoming: boolean }) {
    const car = booking.cars
    const projectID = "fmueikfpthimanfrituz"

    const [initialCancel, setInitialCancel] = useState(false)
    const [confirmCancel, setConfirmCancel] = useState(false)

    const start = new Date(booking.start_time)
    const end = new Date(booking.end_time)

    // Resuming a pending checkout has to rebuild the exact search params the car
    // page would have produced, which means reversing wallClockToUtcIso rather
    // than slicing the stored timestamp.
    //
    // `start_time.split('T')[0]` took the UTC day and `start.getHours()` took the
    // browser's clock, and neither is the day or the hour on the reservation: a
    // 10pm Central return is 03:00Z the next day, so the split handed checkout an
    // endDate one day late. That was survivable only because createCheckoutSession
    // short-circuits on bookingId and returns the stored booking untouched — but
    // if the pending row has since been swept, it falls through and books the
    // wrong range for real.
    const checkoutParams = {
        startDate: businessDateKey(start),
        endDate: businessDateKey(end),
        startTime: businessWallClockTime(start),
        endTime: businessWallClockTime(end),
        totalDays: Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
        subtotal: booking.total_price,
        pickupLocation: booking.pickup_location,
    }

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
        <div className={`flex flex-col md:flex-row gap-6 bg-gray-200 border border-gray-800 rounded-2xl p-6 transition-all ${!isUpcoming && 'opacity-80'}`}>

            {/* Car Image */}
            <div className="w-full rounded-lg md:w-48 h-32 flex-shrink-0">
                <img
                    src={`https://${projectID}.supabase.co/storage/v1/object/public/car%20gallery/car_${car.id}/main.PNG`}
                    alt={`${car.make} ${car.model} ${car.year} `}
                    className="w-full h-full border border-black object-cover rounded-xl"
                />
            </div>

            {/* Details */}
            <div className="flex-1 flex flex-col justify-between">
                <div>
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="text-xl text-black font-bold">{car.make} {car.model} {car.trim} {car.year}</h3>

                        {/* Status Badge */}
                        <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                            booking.status === 'confirmed' ? 'bg-[#3a7d2c]/80 text-green-950' :
                                booking.status === 'canceled' ? 'bg-red-900/30 text-red-800' :
                                    booking.status === 'completed' ? 'bg-blue-900/30 text-blue-800' :
                                        booking.status === 'pending' ? 'bg-amber-300/60 text-black':
                                            'bg-gray-800 text-gray-400'

                        }`}>
                            {booking.status.toUpperCase()}
                        </span>
                    </div>

                    {/* Displaying trip times and location */}
                    <div className="flex text-black items-center gap-2">
                        <CalendarDays size={14} /> {formatDate(booking.start_time)} — {formatDate(booking.end_time)}
                    </div>
                    <div className="flex text-black items-center gap-2">
                        <MapPin size={14} /> {booking.pickup_location}
                    </div>

                    {/* Only show "View Receipt" for confirmed trips */}
                    <div className="mt-2">
                        {booking.status === 'confirmed' && (
                            <Link
                                to="/booking-confirmed"
                                search={{ bookingId: booking.id }}
                                className="text-sm font-semibold text-black hover:text-gray-600 transition-colors"
                            >
                                View Receipt →
                            </Link>
                        )}
                    </div>

                </div>

                <div className="flex justify-between items-end mt-4 pt-4 border-t border-[#2a4a1e]">
                    <div>
                        <p className="text-xs mt-2 text-black">Total Paid</p>
                        <p className="font-bold text-black">${booking.total_price}</p>
                    </div>

                    {/* Only show Cancel Trip option if status is confirmed and the dates have not past */}
                    {(booking.status === 'confirmed') && (new Date(booking.end_time) >= new Date()) && (
                        <div className="flex flex-col items-end">
                            {!initialCancel ? (
                                <button
                                    onClick={() => setInitialCancel(true)}
                                    className="text-sm font-bold text-red-700 hover:text-red-500 transition-colors cursor-pointer"
                                >
                                    Cancel Trip
                                </button>
                            ) : (
                                <div className="flex items-center gap-3 rounded-lg">
                                    <span className="text-xs text-black">Are you sure?</span>
                                    <button
                                        onClick={handleCancel}
                                        disabled={confirmCancel}
                                        className="text-xs text-black bg-red-700/80 px-3 py-1 rounded-md hover:bg-red-500 border border-black disabled:opacity-50 cursor-pointer"
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
                    )}

                    {booking.status === 'pending' && (
                        <div className="flex flex-row gap-x-4">
                            {!initialCancel ? (
                                <button
                                    onClick={() => setInitialCancel(true)}
                                    className="text-sm font-bold text-red-700 hover:text-red-500 transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                            ) : (
                                <div className="flex items-center gap-3 rounded-lg">
                                    <span className="text-xs text-black">Are you sure?</span>
                                    <button
                                        onClick={handleCancel}
                                        disabled={confirmCancel}
                                        className="text-xs text-black bg-red-700/90 px-3 py-1 rounded-md hover:bg-red-500 border border-black disabled:opacity-50 cursor-pointer"
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

                            <Link
                                to="/checkout/$carId"
                                params={{ carId: car.id.toString() }}
                                search={{ ...checkoutParams, bookingId: booking.id }}
                                className="bg-amber-300/60 hover:bg-amber-200/50 text-black text-xs font-bold px-2 py-2 rounded-lg transition-colors"
                            >
                                Finish Checkout →
                            </Link>
                        </div>
                    )}

                </div>
            </div>
        </div>
    )
}