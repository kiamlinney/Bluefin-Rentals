import { createFileRoute, Link } from '@tanstack/react-router'
import { getUserBookings } from '@/lib/db'
import { BookingCard } from '../components/BookingCard'

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
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    return (
        <div className="min-h-screen bg-[#152110] py-24 px-4 md:px-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold mb-8">My Bookings</h1>

                {bookings.length === 0 ? (
                    <div className="bg-gray-200 border border-gray-800 rounded-2xl p-12 text-center">
                        <h2 className="text-xl text-gray-800 font-bold mb-2">No bookings yet!</h2>
                        <p className="text-gray-600 mb-6">When you book a car, all trips will appear here.</p>
                        <Link to="/fleet" className="primary-button px-6 py-3 border border-gray-800 text-gray-800 hover:bg-gray-300 font-semibold rounded-xl transition-colors">
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