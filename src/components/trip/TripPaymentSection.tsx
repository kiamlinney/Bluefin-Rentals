import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { TripPaymentState } from '@/lib/db'
import type { BookingRate } from '@/lib/booking-rate'
import { buildCheckoutSearch } from '@/lib/checkout-search'

// Everything the trip page is allowed to say about money, keyed off the state
// getTripForGuest verified against Stripe rather than off booking.status. The
// page this replaced showed "Total paid" for any row it could load, which meant
// an unpaid pending booking rendered as a completed purchase.
//
// Moved out of the route file when the trip page grew a second column; the
// states here are load-bearing and were getting lost among the layout.

// How long to keep re-checking a payment Stripe says is still in flight. Six
// tries at five seconds covers the usual webhook delay; past that, telling the
// guest to check back is more honest than a spinner that never resolves.
const PROCESSING_POLL_MS = 5000
const PROCESSING_POLL_LIMIT = 6

type PaymentBooking = {
    id: string
    total_price: number
    start_time: string
    end_time: string
    pickup_location: string
    car_id: number
    // For buildCheckoutSearch: resuming an unpaid booking has to put the guest
    // back on the rate and extras it was priced at.
    booking_rate: BookingRate
    price_quote?: unknown
}

export function TripPaymentSection({
    paymentState,
    booking,
    card,
    onRecheck,
}: {
    paymentState: TripPaymentState
    booking: PaymentBooking
    card: { brand: string | null; last4: string | null; receiptUrl: string | null } | null
    onRecheck: () => void
}) {
    if (paymentState === 'processing') {
        return <ProcessingPayment onRecheck={onRecheck} />
    }

    if (paymentState === 'unpaid') {
        return (
            <div className="bg-amber-100 border border-amber-700 rounded-2xl p-5 sm:p-6">
                <h3 className="font-bold text-ink">You haven't finished checking out</h3>
                <p className="text-sm text-ink mt-1">
                    This car isn't reserved yet — the dates are still open to other renters until
                    the payment goes through.
                </p>
                <Link
                    to="/checkout/$carId"
                    params={{ carId: booking.car_id.toString() }}
                    search={buildCheckoutSearch(booking)}
                    className="inline-block mt-4 px-5 py-2.5 bg-brand hover:bg-pine-800 text-on-brand font-bold rounded-xl text-sm transition-colors"
                >
                    Finish checkout →
                </Link>
            </div>
        )
    }

    if (paymentState === 'failed') {
        return (
            <div className="bg-red-50 border border-red-700 rounded-2xl p-5 sm:p-6">
                <h3 className="font-bold text-red-900">Payment didn't go through</h3>
                <p className="text-sm text-red-800 mt-1">
                    Nothing was charged and this trip isn't booked. You can start again from the
                    car's page, or get in touch if you think this is wrong.
                </p>
                <Link
                    to="/fleet/$carSlug"
                    // Only the id is on hand here; the route redirects to the slug.
                    params={{ carSlug: booking.car_id.toString() }}
                    className="inline-block mt-4 text-sm font-semibold text-red-900 hover:underline"
                >
                    Back to the car →
                </Link>
            </div>
        )
    }

    if (paymentState === 'canceled') {
        return (
            <div className="bg-surface border border-line rounded-2xl p-5 sm:p-6">
                <h3 className="font-bold text-ink">This trip was canceled</h3>
                {/* Deliberately says nothing about the amount. A cancellation
                    refunds in full, in part, or not at all depending on the rate
                    and the timing — this used to promise a full refund, which is
                    now false more often than not. The cancellation email carries
                    the actual figure. */}
                <p className="text-sm text-muted mt-1">
                    Any refund due has been sent to your original payment method, and usually
                    lands within 5–10 business days. Check your email for the details.
                </p>
            </div>
        )
    }

    // confirmed / completed — the only two states allowed to say "paid". The
    // itemised total lives in the left column's Total cost section now, so this
    // carries only what identifies the payment.
    return (
        <div className="bg-surface border border-line rounded-2xl p-5 sm:p-6 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Payment</h3>

            <div className="flex justify-between text-sm">
                <span className="text-muted">Booking reference</span>
                <span className="text-ink font-mono">{booking.id.slice(0, 8).toUpperCase()}</span>
            </div>

            {card?.last4 && (
                <div className="flex justify-between text-sm">
                    <span className="text-muted">Paid with</span>
                    <span className="text-ink capitalize">
                        {card.brand ?? 'Card'} ···· {card.last4}
                    </span>
                </div>
            )}

            <hr className="border-line" />

            <div className="flex justify-between text-base">
                <span className="font-bold text-ink">Total paid</span>
                <span className="font-bold text-ink">${booking.total_price}</span>
            </div>
        </div>
    )
}

// Stripe says the payment is still in flight. Re-run the loader on a timer:
// getTripForGuest re-checks the PaymentIntent and flips the row itself, so this
// resolves without waiting on the webhook.
function ProcessingPayment({ onRecheck }: { onRecheck: () => void }) {
    const [attempts, setAttempts] = useState(0)
    const gaveUp = attempts >= PROCESSING_POLL_LIMIT

    useEffect(() => {
        if (gaveUp) return
        const timer = setTimeout(() => {
            setAttempts(current => current + 1)
            onRecheck()
        }, PROCESSING_POLL_MS)
        return () => clearTimeout(timer)
        // onRecheck is router.invalidate, stable for the life of the router.
    }, [attempts, gaveUp, onRecheck])

    return (
        <div className="bg-amber-100 border border-amber-700 rounded-2xl p-5 sm:p-6">
            <h3 className="font-bold text-ink">
                {gaveUp ? 'This is taking longer than usual' : 'Confirming your payment…'}
            </h3>
            <p className="text-sm text-ink mt-1">
                {gaveUp
                    ? 'Your booking is safe and nothing is lost — it just hasn’t been confirmed yet. Check My Bookings again shortly, or get in touch and we’ll sort it out.'
                    : 'Your bank is still processing this. This page updates on its own — no need to refresh.'}
            </p>
            {gaveUp && (
                <Link to="/contact" className="inline-block mt-4 text-sm font-semibold text-pine-700 hover:underline">
                    Contact us →
                </Link>
            )}
        </div>
    )
}
