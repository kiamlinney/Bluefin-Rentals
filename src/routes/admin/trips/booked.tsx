import {createFileRoute} from '@tanstack/react-router'
import {getConfirmedBookings, sendTestBookingEmail} from '@/lib/db'
import { TripCard } from 'src/components/admin/TripCard.tsx'
import type { BookingWithRelations } from '@/types.ts'
import { businessDateKey, formatBusinessDate, isBusinessToday } from '@/lib/dates'
import { useState } from "react";

type DateGroup = {
    dateKey: string      // used as React key
    dateLabel: string    // what gets displayed
    sortDate: Date       // used for sorting groups chronologically
    bookings: BookingWithRelations[]
}

export const Route = createFileRoute('/admin/trips/booked')({
    loader: async () => {
        const bookings = await getConfirmedBookings()
        return { bookings }
    },
    component: BookedPage,
})

// function InspectTuroEmailPanel() {
//     const [result, setResult] = useState<null | {
//         subject: string
//         snippet: string
//         plainText: string | null
//         htmlSnippet: string | null
//         mimeType: string
//     }>(null)
//     const [loading, setLoading] = useState(false)
//     const [error, setError] = useState<string | null>(null)
//
//     async function handleClick() {
//         const defaultId = '19fa8aa569d3a5dc'
//         const answer = window.prompt('Enter a Gmail message id to inspect', defaultId)
//         if (typeof answer !== 'string' || !answer.trim()) return
//
//         setLoading(true)
//         setError(null)
//         setResult(null)
//
//         try {
//             const messageId = answer.trim()
//             // If you changed server to POST + string:
//             const res = await inspectTuroEmail({data: messageId})
//             // If you kept GET + object shape:
//             // const res = await inspectTuroEmail({ id: messageId })
//
//             setResult(res)
//             // Optional: still log to console
//             console.log('inspect result', res)
//             console.log('plainText length', res.plainText?.length ?? 0)
//         } catch (e: any) {
//             console.error(e)
//             setError(e?.message || 'Inspect failed — see server logs')
//         } finally {
//             setLoading(false)
//         }
//     }
//
//     return (
//         <div className="space-y-3">
//             <button onClick={handleClick} className="px-3 py-2 border rounded">
//                 {loading ? 'Inspecting…' : 'Inspect Turo Email'}
//             </button>
//
//             {error && (
//                 <div className="text-red-600 text-sm">{error}</div>
//             )}
//
//             {result && (
//                 <div className="border rounded p-3 bg-white text-sm space-y-2">
//                     <div><strong>Subject:</strong> {result.subject}</div>
//                     <div><strong>Snippet:</strong> {result.snippet}</div>
//                     <div><strong>MIME:</strong> {result.mimeType}</div>
//
//                     {result.plainText && (
//                         <div>
//                             <div className="font-semibold mb-1">Plain text</div>
//                             <textarea
//                                 readOnly
//                                 className="w-full h-64 border rounded p-2 font-mono text-xs"
//                                 value={result.plainText}
//                             />
//                         </div>
//                     )}
//
//                     {result.htmlSnippet && (
//                         <div>
//                             <div className="font-semibold mb-1">HTML snippet</div>
//                             <textarea
//                                 readOnly
//                                 className="w-full h-64 border rounded p-2 font-mono text-xs"
//                                 value={result.htmlSnippet}
//                             />
//                         </div>
//                     )}
//
//                     <pre className="bg-gray-50 border rounded p-2 overflow-auto">
//             {JSON.stringify(result, null, 2)}
//           </pre>
//                 </div>
//             )}
//         </div>
//     )
// }

// function SyncTuroBookingsButton() {
//     const [loading, setLoading] = useState(false)
//     const [error, setError] = useState<string | null>(null)
//     const router = useRouter()
//
//     async function handleClick() {
//         setLoading(true)
//         setError(null)
//         try {
//             const result = await syncTuroBookings() // no args
//             console.log('sync result', result)
//
//             // Optionally show a quick toast/alert
//             alert(`Sync complete.\n` + JSON.stringify(result, null, 2))
//             console.log(result)
//
//             // Refresh this page’s loader data so the new bookings show up
//             await router.invalidate()
//         } catch (e: any) {
//             console.error(e)
//             setError(e?.message || 'Sync failed — see server logs')
//         } finally {
//             setLoading(false)
//         }
//     }
//
//     return (
//         <div className="space-y-2">
//             <button onClick={handleClick} className="px-3 py-2 border rounded">
//                 {loading ? 'Syncing…' : 'Sync Turo Bookings'}
//             </button>
//             {error && <div className="text-red-600 text-sm">{error}</div>}
//         </div>
//     )
// }

// Sends the admin "trip is booked" email for a booking that already exists, so
// the template can be checked without paying for a trip. Ignores
// admin_notified_at, so the same booking can be re-sent as many times as needed.
function SendTestBookingEmailButton({ bookings }: { bookings: BookingWithRelations[] }) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sent, setSent] = useState(false)

    async function handleClick() {
        // Defaulted to the first booking on the page — the common case is
        // "send me whatever's at the top", and any other id can be pasted in.
        const answer = window.prompt('Booking id to send the admin email for', bookings[0]?.id ?? '')
        if (typeof answer !== 'string' || !answer.trim()) return

        setLoading(true)
        setError(null)
        setSent(false)
        try {
            await sendTestBookingEmail({ data: { bookingId: answer.trim() } })
            setSent(true)
        } catch (e: any) {
            console.error(e)
            setError(e?.message || 'Send failed — see server logs')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-2 mb-6">
            <button onClick={handleClick} className="px-3 py-2 border rounded">
                {loading ? 'Sending…' : 'Send test booking email'}
            </button>
            {sent && <div className="text-green-700 text-sm">Sent — check the inbox.</div>}
            {error && <div className="text-red-600 text-sm">{error}</div>}
        </div>
    )
}

function groupBookingsByDate(bookings: BookingWithRelations[]): DateGroup[] {
    const now = new Date();

    // Map to collect groups
    const groups = new Map<string, DateGroup>()

    for (const booking of bookings) {
        const startTime = new Date(booking.start_time)
        const endTime = new Date(booking.end_time)

        const isActive = startTime <= now
        const relevantDate = isActive ? endTime : startTime

        // Grouped by the business calendar day. Built from getFullYear/getMonth/
        // getDate this read the host's day, so a late-evening return fell into
        // the next day's heading for anyone west of Central.
        const dateKey = businessDateKey(relevantDate)

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
    // Determining if today — compared as business calendar days, so the heading
    // flips over at midnight at the lot rather than midnight where the host is.
    if (isBusinessToday(date)) {
        return 'Today'
    }

    return formatBusinessDate(date, {
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
        <div className="py-8 md:py-16 px-4 md:px-8">
            <div className="max-w-2xl mx-auto">
                <h1 className="mb-8 text-3xl text-black font-bold">Booked</h1>
                {/*< SyncTuroBookingsButton />*/}
                {/*< InspectTuroEmailPanel />*/}
                <SendTestBookingEmailButton bookings={bookings} />
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