import { createFileRoute, Link } from '@tanstack/react-router'
import { cancelBooking, getUserBookings } from '@/lib/db'
import { MapPin, CalendarDays } from 'lucide-react';
import { useState } from "react";

export const Route = createFileRoute('/_authed/my-bookings')({
    loader: async () => {
        const bookings = await getUserBookings()
        return { bookings }
    },
    component: MyBookingsPage,
})

function MyBookingsPage() {
    const { bookings } = Route.useLoaderData()

    const now = new Date()
    const upcomingBookings = bookings.filter((b: any) => new Date(b.end_time) >= now && b.status === 'confirmed')
    const pastBookings = bookings.filter((b: any) => (b.status === 'completed') || b.status === 'canceled')
    const pendingBookings = bookings.filter((b: any) => b.status === 'pending')

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })
    }

    return (
        <div className="min-h-screen bg-[#152110] py-24 px-4 md:px-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold mb-8">My Bookings</h1>

                {bookings.length === 0 ? (
                    <div className="bg-[#1e3318] border border-[#2a4a1e] rounded-2xl p-12 text-center">
                        <h2 className="text-xl font-bold mb-2">No bookings yet!</h2>
                        <p className="text-[#6a9455] mb-6">When you book a car, all trips will appear here.</p>
                        <Link to="/fleet" className="px-6 py-3 bg-[#3a7d2c] hover:bg-[#4a9e38] text-white font-semibold rounded-xl transition-colors">
                            Browse Cars
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-12">
                        {/* Upcoming Trips */}
                        {upcomingBookings.length > 0 && (
                            <section>
                                <h2 className="text-xl font-bold mb-4 border-b border-[#2a4a1e] pb-2">Upcoming Trips</h2>
                                <div className="space-y-4">
                                    {upcomingBookings.map((booking: any) => (
                                        <BookingCard key={booking.id} booking={booking} formatDate={formatDate} isUpcoming={true} />
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Pending Trips */}
                        {pendingBookings.length > 0 && (
                            <section>
                                <h2 className="text-xl font-bold  mb-4 border-b border-[#2a4a1e] pb-2">Pending Checkouts</h2>
                                <div className="space-y-4">
                                    {pendingBookings.map((booking: any) => (
                                        <BookingCard key={booking.id} booking={booking} formatDate={formatDate} isUpcoming={true} />
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Past Trips */}
                        {pastBookings.length > 0 && (
                            <section>
                                <h2 className="text-xl font-bold mb-4 border-b border-[#2a4a1e] pb-2">Past Trips</h2>
                                <div className="space-y-4">
                                    {pastBookings.map((booking: any) => (
                                        <BookingCard key={booking.id} booking={booking} formatDate={formatDate} isUpcoming={false} />
                                    ))}
                                </div>
                            </section>
                        )}

                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Reusable Card Component ──────────────────────────────────────────────────
function BookingCard({ booking, formatDate, isUpcoming }: { booking: any, formatDate: any, isUpcoming: boolean }) {
    const car = booking.cars
    const projectID = "fmueikfpthimanfrituz"

    const [initialCancel, setInitialCancel] = useState(false)
    const [confirmCancel, setConfirmCancel] = useState(false)

    const start = new Date(booking.start_time)
    const end = new Date(booking.end_time)

    const checkoutParams = {
        startDate: booking.start_time.split('T')[0],
        endDate: booking.end_time.split('T')[0],
        startTime: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
        endTime: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
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
                    alt={`${car.year} ${car.make} ${car.model}`}
                    className="w-full h-full border border-black object-cover rounded-xl"
                />
            </div>

            {/* Details */}
            <div className="flex-1 flex flex-col justify-between">
                <div>
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="text-xl text-black font-bold">{car.year} {car.make} {car.model}</h3>

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