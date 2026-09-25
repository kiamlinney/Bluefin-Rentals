import { createFileRoute, Link } from '@tanstack/react-router'
import { getUserBookings } from '@/lib/db'
import { UpcomingTripCard } from '@/components/trips/UpcomingTripCard'
import { PendingCheckoutCard } from '@/components/trips/PendingCheckoutCard'
import { TripHistoryRow } from '@/components/trips/TripHistoryRow'
import { NoTripsIllustration } from '@/components/trips/NoTripsIllustration'

// The guest's list of trips.
//
// Three sections, and they're different kinds of thing rather than three
// filters over one card: a booked trip you're about to take, a checkout you
// walked away from, and something that already happened. Each gets a component
// shaped for what you'd actually do with it.
//
// `expired` never appears — getUserBookings filters it out, which is what makes
// a discarded checkout disappear from here rather than sitting in History as a
// trip that never was. See cancelBooking.
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
    const upcoming = bookings.filter(
        (b: any) => new Date(b.end_time) >= now && b.status === 'confirmed',
    )
    const pending = bookings.filter((b: any) => b.status === 'pending')
    const history = bookings.filter(
        (b: any) =>
            b.status === 'completed' ||
            b.status === 'canceled' ||
            (b.status === 'confirmed' && new Date(b.end_time) < now),
    )

    return (
        <div className="min-h-screen pt-20 pb-16 md:py-24 px-4 md:px-8">
            <div className="max-w-3xl mx-auto space-y-10 sm:space-y-12">
                <h1 className="text-3xl font-bold text-ink">Trips</h1>

                {/* Upcoming, or the empty state in its place. Shown even when
                    History has rows: "no upcoming trips" is the useful answer
                    to "what's next?", and past trips don't change it. */}
                <section className="space-y-4">
                    <h2 className="text-xl font-bold text-ink">Upcoming</h2>

                    {upcoming.length === 0 ? (
                        <div className="text-center py-10">
                            <NoTripsIllustration className="w-56 max-w-full mx-auto" />
                            <h3 className="text-xl font-bold text-ink mt-6">No upcoming trips yet</h3>
                            <p className="text-muted mt-2">
                                Have a look at the fleet and book your next one.
                            </p>
                            <Link
                                to="/fleet"
                                className="inline-block mt-6 px-6 py-3 bg-brand hover:bg-pine-800 text-on-brand font-bold rounded-xl transition-colors"
                            >
                                Start searching
                            </Link>
                        </div>
                    ) : (
                        upcoming.map((booking: any) => (
                            <UpcomingTripCard key={booking.id} booking={booking} />
                        ))
                    )}
                </section>

                {pending.length > 0 && (
                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-ink">Pending checkouts</h2>
                        <p className="text-sm text-muted">
                            Started but not paid for. These aren't booked until you finish.
                        </p>
                        {pending.map((booking: any) => (
                            <PendingCheckoutCard key={booking.id} booking={booking} />
                        ))}
                    </section>
                )}

                {history.length > 0 && (
                    <section className="space-y-3">
                        <h2 className="text-xl font-bold text-ink">History</h2>
                        {history.map((booking: any) => (
                            <TripHistoryRow key={booking.id} booking={booking} />
                        ))}
                    </section>
                )}
            </div>
        </div>
    )
}
