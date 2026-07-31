import {createFileRoute, useRouter} from '@tanstack/react-router'
import {getConfirmedBookings, inspectTuroEmail, syncTuroBookings} from '@/lib/db'
import { TripCard } from 'src/components/admin/TripCard.tsx'
import { useState } from "react";

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

function InspectTuroEmailPanel() {
    const [result, setResult] = useState<null | {
        subject: string
        snippet: string
        plainText: string | null
        htmlSnippet: string | null
        mimeType: string
    }>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleClick() {
        const defaultId = '19fa8aa569d3a5dc'
        const answer = window.prompt('Enter a Gmail message id to inspect', defaultId)
        if (typeof answer !== 'string' || !answer.trim()) return

        setLoading(true)
        setError(null)
        setResult(null)

        try {
            const messageId = answer.trim()
            // If you changed server to POST + string:
            const res = await inspectTuroEmail({data: messageId})
            // If you kept GET + object shape:
            // const res = await inspectTuroEmail({ id: messageId })

            setResult(res)
            // Optional: still log to console
            console.log('inspect result', res)
            console.log('plainText length', res.plainText?.length ?? 0)
        } catch (e: any) {
            console.error(e)
            setError(e?.message || 'Inspect failed — see server logs')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-3">
            <button onClick={handleClick} className="px-3 py-2 border rounded">
                {loading ? 'Inspecting…' : 'Inspect Turo Email'}
            </button>

            {error && (
                <div className="text-red-600 text-sm">{error}</div>
            )}

            {result && (
                <div className="border rounded p-3 bg-white text-sm space-y-2">
                    <div><strong>Subject:</strong> {result.subject}</div>
                    <div><strong>Snippet:</strong> {result.snippet}</div>
                    <div><strong>MIME:</strong> {result.mimeType}</div>

                    {result.plainText && (
                        <div>
                            <div className="font-semibold mb-1">Plain text</div>
                            <textarea
                                readOnly
                                className="w-full h-64 border rounded p-2 font-mono text-xs"
                                value={result.plainText}
                            />
                        </div>
                    )}

                    {result.htmlSnippet && (
                        <div>
                            <div className="font-semibold mb-1">HTML snippet</div>
                            <textarea
                                readOnly
                                className="w-full h-64 border rounded p-2 font-mono text-xs"
                                value={result.htmlSnippet}
                            />
                        </div>
                    )}

                    <pre className="bg-gray-50 border rounded p-2 overflow-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
                </div>
            )}
        </div>
    )
}

function SyncTuroBookingsButton() {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()

    async function handleClick() {
        setLoading(true)
        setError(null)
        try {
            const result = await syncTuroBookings() // no args
            console.log('sync result', result)

            // Optionally show a quick toast/alert
            alert(`Sync complete.\n` + JSON.stringify(result, null, 2))
            console.log(result)

            // Refresh this page’s loader data so the new bookings show up
            await router.invalidate()
        } catch (e: any) {
            console.error(e)
            setError(e?.message || 'Sync failed — see server logs')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-2">
            <button onClick={handleClick} className="px-3 py-2 border rounded">
                {loading ? 'Syncing…' : 'Sync Turo Bookings'}
            </button>
            {error && <div className="text-red-600 text-sm">{error}</div>}
        </div>
    )
}

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
                < SyncTuroBookingsButton />
                < InspectTuroEmailPanel />
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