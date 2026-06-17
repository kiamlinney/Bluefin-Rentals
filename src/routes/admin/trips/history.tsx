import {createFileRoute} from '@tanstack/react-router'
import {getPastBookings} from '@/lib/db'
import {TripCard} from 'src/components/admin/TripCard.tsx'

type Booking = {
    id: string
    car_id: number
    user_id: string
    start_time: string
    end_time: string
    total_price: number
    status: string
    created_at: string
    stripe_payment_intent_id: string
    pickup_location: string
}

type DateGroup = {
    dateKey: string      // used as React key
    dateLabel: string    // what gets displayed
    sortDate: Date       // used for sorting groups chronologically
    bookings: Booking[]
}

export const Route = createFileRoute('/admin/trips/history')({
    loader: async () => {
        const bookings = await getPastBookings()
        return { bookings }
    },
    component: HistoryPage,
})

function groupBookingsByDate(bookings: Booking[]): DateGroup[] {

    // Map to collect groups
    const groups = new Map<string, DateGroup>()

    for (const booking of bookings) {
        const relevantDate = new Date(booking.end_time)

        const dateKey = `${relevantDate.getFullYear()}-${relevantDate.getMonth()}`

        // If this date key doesn't exist in the map yet, then create it
        if (!groups.has(dateKey)) {
            // Lock sort date to the 1st of the month
            const normalizedSortDate = new Date(relevantDate.getFullYear(), relevantDate.getMonth(), 1)

            groups.set(dateKey, {
                dateKey,
                dateLabel: formatGroupLabel(relevantDate),
                sortDate: normalizedSortDate,
                bookings: [],
            })
        }

        // Push this booking into the correct group
        groups.get(dateKey)!.bookings.push(booking)
    }

    // Convert the map to an array so it can be sorted
    const sortedGroups = Array.from(groups.values()).sort(
        // For history is b - a instead of a - b
        (a, b) => b.sortDate.getTime() - a.sortDate.getTime()
    )

    // For history, sort individual trips descending by end time
    sortedGroups.forEach(group => {
        group.bookings.sort((a, b) => {
                return new Date(b.end_time).getTime() - new Date(a.end_time).getTime()
            })
    })

    return sortedGroups
}

function formatGroupLabel(date: Date): string {
    return date.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
    })
    // Produces: "June 2026"
}

function HistoryPage() {
    const { bookings } = Route.useLoaderData();

    const groups = groupBookingsByDate(bookings)

    return (
        <div className="min-h-screen py-16 px-4 md:px-8">
            <div className="max-w-2xl mx-auto">
                <h1 className="mb-8 text-3xl text-black font-bold">History</h1>

                {bookings.length === 0 ? (
                    <div className="">
                        <h2 className="text-xl font-bold mb-2">No past bookings.</h2>
                        <p className="mb-6">All past trips will appear here.</p>
                    </div>
                ) : (
                    <div className="space-y-10">
                        {groups.map(group => (
                            <section>
                                <h2 className="text-base text-gray-700 mb-3">
                                    {group.dateLabel}
                                </h2>
                                <hr className="border-gray-200 mb-4" />

                                <div className="space-y-3">
                                    {group.bookings.map(booking => (
                                        <TripCard
                                            key={booking.id}
                                            booking={booking}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </div>
        </div>

    )
}