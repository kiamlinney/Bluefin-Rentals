import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Printer } from 'lucide-react'
import { getTripForGuest } from '@/lib/db.ts'
import { buildReceipt } from '@/lib/receipt.ts'
import { TripReceipt } from '@/components/trip/TripReceipt.tsx'
import { displayName } from '@/lib/profile.ts'
import type { BookingWithDetails } from '@/types.ts'

// The trailing underscore on $bookingId_ opts this route out of nesting under
// _authed.trips.$bookingId.tsx, so it renders as its own page. The URL is
// unaffected: /trips/{bookingId}/receipt.
//
// One page for both roles,
// getTripForGuest goes through assertBookingAccess, which admits the platform
// admin or the renter on the booking and nobody else — so the document is
// identical for both and only the back link and the guest row differ.
//
// getTripForGuest rather than getBookingById because a receipt has to be honest
// about payment: it selects `bookings.*` (so price_quote, booking_rate and
// refunded_amount all arrive) *and* checks the PaymentIntent, returning the
// verified payment state plus the card it was paid with. Reading `status` off
// the row would print "Trip total" over an abandoned checkout.
export const Route = createFileRoute('/_authed/trips/$bookingId_/receipt')({
    loader: async ({ params }) => {
        const trip = await getTripForGuest({ data: params.bookingId })
        const booking = trip.booking as BookingWithDetails
        return { ...trip, booking, receipt: buildReceipt(booking, booking.cars) }
    },
    component: TripReceiptPage,
})

function TripReceiptPage() {
    const { booking, receipt, card, paymentState, isAdmin } = Route.useLoaderData()
    const { bookingId } = Route.useParams()

    return (
        <div className="min-h-screen px-4 py-24 md:px-8">
            <div className="mx-auto max-w-3xl">

                {/* Page chrome. None of it belongs on paper — the print rules
                    strip this row, and Navbar/Footer hide themselves. */}
                <div className="flex items-center justify-between gap-4 print:hidden">
                    {isAdmin ? (
                        <Link
                            to="/admin/reservation/$bookingId"
                            params={{ bookingId }}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-pine-500 hover:underline"
                        >
                            <ArrowLeft size={16} />
                            {displayName(booking.profiles).split(' ')[0]}'s trip
                        </Link>
                    ) : (
                        <Link
                            to="/trips/$bookingId"
                            params={{ bookingId }}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-pine-500 hover:underline"
                        >
                            <ArrowLeft size={16} />
                            Back to trip
                        </Link>
                    )}

                    <button
                        onClick={() => window.print()}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-subtle"
                    >
                        <Printer size={16} />
                        Print
                    </button>
                </div>

                <div className="mt-4">
                    <TripReceipt
                        booking={booking}
                        receipt={receipt}
                        card={card}
                        paymentState={paymentState}
                        isAdmin={isAdmin}
                    />
                </div>
            </div>
        </div>
    )
}