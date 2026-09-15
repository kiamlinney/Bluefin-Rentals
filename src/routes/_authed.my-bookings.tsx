import { createFileRoute, Link } from '@tanstack/react-router'
import { getUserBookings } from '@/lib/db'
import { formatBusinessDateTime } from '@/lib/dates'
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

    // Booking times are wall-clock times at the lot, so they're rendered in the
    // business's timezone rather than the viewer's — a customer booking from
    // California picked a 10am pickup and should be shown 10am, not 8am.
    const formatDate = (dateStr: string) =>
        formatBusinessDateTime(
            dateStr,
            { month: 'long', day: 'numeric' },
            { hour: '2-digit', minute: '2-digit' },
        )

    return (
        <div className="min-h-screen py-24 px-4 md:px-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold mb-8">My Bookings</h1>

                {bookings.length === 0 ? (
                    <div className="bg-surface border border-line rounded-2xl p-12 text-center">
                        <h2 className="text-xl font-bold mb-2">No bookings yet!</h2>
                        <p className="text-muted mb-6">When you book a car, all trips will appear here.</p>
                        <Link to="/fleet" className="primary-button px-6 py-3 font-semibold rounded-xl transition-colors">
                            Browse Cars
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-12">
                        {/* Upcoming Trips */}
                        {upcomingBookings.length > 0 && (
                            <section>
                                <h2 className="text-xl font-bold mb-4 border-b border-line pb-2">Upcoming Trips</h2>
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
                                <h2 className="text-xl font-bold  mb-4 border-b border-line pb-2">Pending Checkouts</h2>
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
                                <h2 className="text-xl font-bold mb-4 border-b border-line pb-2">Past Trips</h2>
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