import { createFileRoute } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { seoMeta } from '@/lib/business'
import { FREE_CANCELLATION_HOURS } from '@/lib/booking-rate.ts'
import {
    LATE_BOOKING_GRACE_HOURS,
    LATE_BOOKING_WINDOW_HOURS,
    SHORT_TRIP_DAYS,
} from '@/lib/cancellation-policy.ts'

// The published version of the rules cancelBooking enforces.
//
// Every number on this page is interpolated from the same constants the code
// uses, rather than typed out as prose. This page is linked from checkout
// (BookingRateInfoModal) and is what a customer will hold the business to, so a
// hand-written "24 hours" here could silently disagree with the enforcement
// after someone edits a constant — and the customer would be right and the site
// would be wrong.

export const Route = createFileRoute('/policies/cancellation')({
    head: () => ({
        meta: seoMeta({
            title: 'Cancellation policy | BlueFin Rentals',
            description:
                'When a BlueFin Rentals trip can be canceled, and what refund applies.',
            path: '/policies/cancellation',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/policies/cancellation') }],
    }),
    component: CancellationPolicy,
})

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mb-8">
            <h3 className="text-lg font-bold mb-2">{title}</h3>
            <div className="space-y-3 text-sm leading-relaxed">{children}</div>
        </section>
    )
}

function CancellationPolicy() {
    return (
        <article className="max-w-2xl">
            <h2 className="text-2xl font-bold mb-2">Cancellation policy</h2>
            <p className="text-sm text-muted mb-8">Last revised: August 28, 2026</p>

            <Section title="Canceling a trip">
                <p>
                    You can cancel a booked trip at any time before it starts, from{' '}
                    <span className="font-semibold">My trips</span>. Cancellation takes effect
                    immediately and the car is released for other guests.
                </p>
                <p>
                    Whether you receive a full refund, a partial refund, or no refund depends on
                    the rate you booked, when you booked, and when you cancel. All times are
                    measured in the vehicle's local time zone (Central).
                </p>
            </Section>

            <Section title="Your free cancellation window">
                <p>
                    Every booking has a window during which cancelling costs you nothing. When it
                    closes depends on the rate you chose:
                </p>
                <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                        <span className="font-semibold">Refundable</span> — free until{' '}
                        {FREE_CANCELLATION_HOURS} hours before your trip starts.
                    </li>
                    <li>
                        <span className="font-semibold">Non-refundable</span> — free until{' '}
                        {FREE_CANCELLATION_HOURS} hours after you book, or{' '}
                        {FREE_CANCELLATION_HOURS} hours before pickup, whichever comes first.
                    </li>
                    <li>
                        <span className="font-semibold">Either rate, booked close to pickup</span> —
                        if you book within {LATE_BOOKING_WINDOW_HOURS} hours of your trip start
                        time, there is no {FREE_CANCELLATION_HOURS}-hour window left to give, so you
                        have {LATE_BOOKING_GRACE_HOURS} hour after booking instead.
                    </li>
                </ul>
                <p>
                    Cancelling inside your window is always a full refund. What happens after it
                    closes is what the two rates actually differ on, below.
                </p>
            </Section>

            <Section title="Full refund">
                <p>You receive a full refund if any of the following apply:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                    <li>You cancel inside your free cancellation window, as defined above.</li>
                    <li>BlueFin Rentals cancels your trip, for any reason.</li>
                </ul>
            </Section>

            <Section title="Partial refund">
                <p>
                    This applies to the <span className="font-semibold">refundable</span> rate
                    only. If you cancel after your free cancellation window has closed but before
                    the trip starts, a cancellation fee is retained and the rest is refunded:
                </p>
                <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                        Trips longer than {SHORT_TRIP_DAYS} days: the fee is the average cost of
                        one day of the trip.
                    </li>
                    <li>
                        Trips of {SHORT_TRIP_DAYS} days or shorter: the fee is half the average
                        cost of one day.
                    </li>
                </ul>
                <p>
                    The average day is calculated from your trip price — what the days themselves
                    cost after any discounts, not counting delivery. Any delivery fee is refunded
                    in full, since the car was never delivered. The premium paid for the
                    refundable rate is not refunded.
                </p>
            </Section>

            <Section title="No refund">
                <p>No refund is issued if:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                        You booked the <span className="font-semibold">non-refundable</span> rate
                        and cancel after your free cancellation window has closed.
                    </li>
                    <li>You cancel at or after your scheduled trip start time.</li>
                </ul>
                <p>
                    Returning a car early does not entitle you to a refund for the unused time.
                </p>
            </Section>

            <Section title="Refunds">
                <p>
                    Refunds are returned to the card used to book and usually appear within 5–10
                    business days, depending on your bank. You'll receive an email confirming the
                    cancellation and the exact amount refunded.
                </p>
            </Section>

            <Section title="Exceptions">
                <p>
                    If something goes wrong that isn't covered above — a flight delay, a problem
                    with the vehicle at pickup, or other circumstances outside your control —
                    contact us before your trip starts. We handle these case by case and can issue
                    a full refund at our discretion.
                </p>
            </Section>
        </article>
    )
}