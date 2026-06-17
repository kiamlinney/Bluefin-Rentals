import { createFileRoute } from '@tanstack/react-router'
import { getConfirmedBookings } from '@/lib/db'
import { TripCard } from 'src/components/admin/TripCard.tsx'

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

export const Route = createFileRoute('/admin/trips/booked')({
    loader: async () => {
        const bookings = await getConfirmedBookings()
        return { bookings }
    },
    component: BookedPage,
})

function groupBookingsByDate(bookings: Booking[]): DateGroup[] {
    const now = new Date();

    // Map to collect groups
    const groups = new Map<string, DateGroup>()

    for (const booking of bookings) {
        const startTime = new Date(booking.start_time)
        const endTime = new Date(booking.end_time)

        const isActive = startTime <= now
        const relevantDate = isActive ? endTime : startTime

        const dateKey = `${relevantDate.getFullYear()}-${relevantDate.getMonth()}-${relevantDate.getDate()}`

        // If this date key doesn't exist in the map yet, then create it
        if (!groups.has(dateKey)) {
            groups.set(dateKey, {
                dateKey,
                dateLabel: formatGroupLabel(relevantDate),
                sortDate: relevantDate,
                bookings: [],
            })
        }

        // Push this booking into the correct group
        groups.get(dateKey)!.bookings.push(booking)
    }

    // Convert the map to an array so it can be sorted
    const sortedGroups = Array.from(groups.values()).sort(
        (a, b) => a.sortDate.getTime() - b.sortDate.getTime()
    )

    // Within each group, sort bookings by their relevant time
    // Active trips sort by end_time, upcoming by start_time
    sortedGroups.forEach(group => {
        group.bookings.sort((a, b) => {
            const aTime = new Date(a.start_time) <= now
                ? new Date(a.end_time).getTime()
                : new Date(a.start_time).getTime()
            const bTime = new Date(b.start_time) <= now
                ? new Date(b.end_time).getTime()
                : new Date(b.start_time).getTime()
            return aTime - bTime
        })
    })

    return sortedGroups
}

function formatGroupLabel(date: Date): string {
    const today = new Date()

    // Determining if today
    if (date.toDateString() === today.toDateString()) {
        return 'Today'
    }

    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    })
    // Produces: "Wednesday, June 10, 2026"
}

function BookedPage() {
    const { bookings } = Route.useLoaderData();

    const groups = groupBookingsByDate(bookings)

    return (
        <div className="min-h-screen py-16 px-4 md:px-8">
            <div className="max-w-2xl mx-auto">
                <h1 className="mb-8 text-3xl text-black font-bold">Booked</h1>

                {bookings.length === 0 ? (
                    <div className="">
                        <h2 className="text-xl font-bold mb-2">No bookings yet!</h2>
                        <p className="mb-6">All trips will appear here once a booking is made.</p>
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