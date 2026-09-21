import { Link } from '@tanstack/react-router'
import { CarFront, Plane } from 'lucide-react'
import type { BookingReceipt } from '@/lib/receipt.ts'
import type { QuoteDay } from '@/lib/pricing.ts'
import { groupQuoteDays } from '@/lib/pricing.ts'
import type { TripPaymentCard, TripPaymentState } from '@/lib/db.ts'
import type { BookingWithDetails } from '@/types.ts'
import { bookingRateLabel } from '@/lib/booking-rate.ts'
import { MILES_INCLUDED_PER_DAY, formatMiles } from '@/lib/distance.ts'
import { displayName } from '@/lib/profile.ts'
import {
    formatBusinessDate,
    formatBusinessDateTime,
    formatBusinessTime,
    formatDayRange,
} from '@/lib/dates.ts'

// The trip receipt document — one printable statement of what a booking cost.
//
// Presentational only: it fetches nothing, holds no state, and derives no money.
// Every figure on it comes off the `receipt` prop, which buildReceipt read from
// the price_quote snapshot frozen at checkout. That's the whole contract — the
// rows here sum to bookings.total_price because they are the same rows the
// PaymentIntent was created from, not because this file adds them up correctly.
//
// ── Where this differs from the Turo receipt it replaces ─────────────────────
// Turo prints a NON-REFUNDABLE DISCOUNT line, because on their pricing the
// flexible rate is standard and giving it up is a markdown. BlueFin is the other
// way round: non-refundable is the anchor everything is quoted from, and
// refundability is sold on top (REFUNDABLE_SURCHARGE, src/lib/booking-rate.ts).
// So the equivalent line here is a REFUNDABLE RATE *charge*, in black with a +.
// Printing it as a discount would tell a guest they'd been given money off a
// price that never existed.

const DATE_FORMAT = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } as const

const formatMoney = (amount: number): string => `$${amount.toFixed(2)}`

const formatPercent = (percent: number): string => `${Math.round(percent * 100)}%`

// Section heading — the small caps label that opens each band.
function BandLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">{children}</p>
    )
}

// One line of the statement, label on the left and amount on the right with a
// dotted leader between them. The leader is a spacer element rather than a CSS
// border trick on the label so it can't collide with a long label wrapping; it
// drops out below `sm`, where justify-between already does the job.
function Line({
    label,
    sub,
    value,
    tone = 'default',
    weight = 'normal',
}: {
    label: React.ReactNode
    sub?: React.ReactNode
    value: React.ReactNode
    tone?: 'default' | 'credit'
    weight?: 'normal' | 'bold'
}) {
    const isBold = weight === 'bold'

    return (
        <div>
            <div className="flex items-baseline justify-between gap-3">
                <span
                    className={[
                        'uppercase tracking-wide',
                        isBold ? 'text-sm font-bold' : 'text-sm',
                        tone === 'credit' ? 'text-pine-700' : 'text-ink',
                    ].join(' ')}
                >
                    {label}
                </span>
                <span
                    aria-hidden="true"
                    className="hidden sm:block flex-1 border-b border-dotted border-line translate-y-[-0.25em]"
                />
                <span
                    className={[
                        'tabular-nums whitespace-nowrap',
                        isBold ? 'text-lg font-bold' : 'text-sm font-medium',
                        tone === 'credit' ? 'text-pine-700' : 'text-ink',
                    ].join(' ')}
                >
                    {value}
                </span>
            </div>
            {sub && <div className="mt-1 text-xs text-muted sm:text-right">{sub}</div>}
        </div>
    )
}

// Same MSP-vs-everything-else split the guest trip page and the admin
// reservation page use, so a pickup reads the same way on all three.
function LocationLine({ pickupLocation }: { pickupLocation: string }) {
    const isAirport = pickupLocation === 'MSP - Minneapolis, MN'

    return (
        <div className="mt-1 flex items-start gap-2 text-ink">
            {isAirport ? (
                <Plane size={16} className="mt-1 shrink-0 text-muted" />
            ) : (
                <CarFront size={16} className="mt-1 shrink-0 text-muted" />
            )}
            <p>
                {isAirport
                    ? 'MSP — Minneapolis−Saint Paul International Airport'
                    : pickupLocation}
            </p>
        </div>
    )
}

// What the trip price is made of, day by day — the same rows the price-details
// modal on the car page shows, built by the same groupQuoteDays, so a guest who
// opened the breakdown before booking recognises the receipt afterwards.
//
// Runs of same-priced days collapse into one range, so a flat-rate trip is a
// single line and a day with its own price gets a row to itself instead of
// being buried in twenty identical ones.
function DayBreakdown({ days }: { days: QuoteDay[] }) {
    const groups = groupQuoteDays(days)
    if (groups.length === 0) return null

    // Amounts are dropped when the whole trip is one run: that figure is the
    // TRIP PRICE directly above, and a line repeating the total above it reads
    // as a mistake. With two or more runs the amounts *are* the arithmetic, so
    // they stay.
    const showAmounts = groups.length > 1

    return (
        <ul className="space-y-1">
            {groups.map(group => (
                <li key={group.start} className="flex items-baseline justify-between gap-3">
                    <span>
                        {formatDayRange(group.start, group.end)}
                        {group.days > 1 && ` · ${group.days} days × ${formatMoney(group.price)}`}
                        {group.isOverride && (
                            <span className="ml-1.5 font-semibold uppercase tracking-wide text-pine-500">
                                Special rate
                            </span>
                        )}
                    </span>
                    {showAmounts && (
                        <span className="tabular-nums">{formatMoney(group.subtotal)}</span>
                    )}
                </li>
            ))}
        </ul>
    )
}

export function TripReceipt({
    booking,
    receipt,
    card,
    paymentState,
    isAdmin,
}: {
    booking: BookingWithDetails
    receipt: BookingReceipt
    card: TripPaymentCard | null
    paymentState: TripPaymentState
    isAdmin: boolean
}) {
    const car = booking.cars
    const profile = booking.profiles
    const quote = receipt.quote

    const wasRefunded = receipt.refundedAmount > 0

    // A receipt must not claim money that hasn't moved — but it must not deny
    // money that has, either. `confirmed`/`completed` is too narrow a test for
    // that: a canceled booking was charged first and refunded after, which is
    // precisely why it has a refund to show. Gating on paid-ness alone printed
    // "not yet charged" directly above a REFUNDED line on the same receipt.
    //
    // So the question is whether a charge exists, not what state the trip is
    // in. `card` is non-null only when the PaymentIntent has a latest_charge,
    // and a refund is proof of one by itself. `processing` is excluded
    // regardless: the charge may exist but hasn't settled.
    const isSettling = paymentState === 'processing'
    const wasCharged =
        !isSettling &&
        (paymentState === 'confirmed' ||
            paymentState === 'completed' ||
            wasRefunded ||
            card !== null)

    const notice = isSettling
        ? "This payment is still being confirmed, so nothing here is final yet."
        : !wasCharged
            ? "This trip hasn't been paid for, so nothing on this receipt has been charged."
            : paymentState === 'canceled'
                ? 'This trip was canceled.'
                : null

    return (
        <article className="overflow-hidden rounded-2xl border border-line bg-surface">

            {/* ── Header ──────────────────────────────────────────────────── */}
            <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-line px-6 py-5 sm:px-8">
                <div>
                    <span className="inline-block rounded-md bg-ink px-2.5 py-1 text-[11px] font-semibold text-page">
                        {bookingRateLabel(booking.booking_rate)} trip
                    </span>
                    <h1 className="mt-3 text-xl text-ink">Trip receipt</h1>
                </div>
                <p className="text-sm text-muted">
                    Reservation{' '}
                    <span className="font-mono text-ink">
                        {booking.id.slice(0, 8).toUpperCase()}
                    </span>
                </p>
            </header>

            {/* ── Car, booked-at, dates, locations ────────────────────────── */}
            <section className="space-y-6 border-b border-line px-6 py-6 sm:px-8">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div>
                        <p className="text-sm text-muted">BlueFin</p>
                        <p className="mt-0.5 text-2xl font-bold text-ink">
                            {/* trim is nullable — filter rather than interpolate,
                                so a car without one prints no trailing space. */}
                            {[car.make, car.model, car.trim].filter(Boolean).join(' ')}{' '}
                            <span className="font-normal text-muted">{car.year}</span>
                        </p>
                    </div>
                    <p className="text-xs uppercase tracking-widest text-muted">
                        Booked {formatBusinessDateTime(booking.created_at)}
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div>
                        <BandLabel>Trip start</BandLabel>
                        <p className="mt-1 text-ink">
                            {formatBusinessDate(booking.start_time, DATE_FORMAT)}
                        </p>
                        <p className="text-sm text-muted">
                            {formatBusinessTime(booking.start_time)} CST
                        </p>
                    </div>
                    <div>
                        <BandLabel>Trip end</BandLabel>
                        <p className="mt-1 text-ink">
                            {formatBusinessDate(booking.end_time, DATE_FORMAT)}
                        </p>
                        <p className="text-sm text-muted">
                            {formatBusinessTime(booking.end_time)} CST
                        </p>
                    </div>
                    {/* One stored location serves both columns. The row records
                        only where the car is handed over; returns come back to
                        the same place, and printing a single "Location" would
                        leave a guest wondering where to bring it. */}
                    <div>
                        <BandLabel>Pickup location</BandLabel>
                        <LocationLine pickupLocation={booking.pickup_location} />
                    </div>
                    <div>
                        <BandLabel>Return location</BandLabel>
                        <LocationLine pickupLocation={booking.pickup_location} />
                    </div>
                </div>
            </section>

            {/* ── Guest ───────────────────────────────────────────────────── */}
            <section className="flex items-center justify-between gap-4 border-b border-line px-6 py-4 sm:px-8">
                <BandLabel>Guest</BandLabel>
                {/* Only the host has anywhere to go from here — the renter is
                    already looking at their own name. */}
                {isAdmin ? (
                    <Link
                        to="/admin/user/$userId"
                        params={{ userId: profile.id }}
                        className="text-sm font-semibold text-pine-500 hover:underline"
                    >
                        {displayName(profile)}
                    </Link>
                ) : (
                    <span className="text-sm text-ink">{displayName(profile)}</span>
                )}
            </section>

            {/* ── Distance allowance ──────────────────────────────────────── */}
            {/* Not a price line. The overage is settled after the trip against a
                real odometer reading, and never enters the total below. */}
            <section className="border-b border-line px-6 py-4 sm:px-8">
                <Line
                    label="Distance included"
                    value={`${formatMiles(receipt.milesIncluded)} mi`}
                    sub={`$${receipt.perMileFee.toFixed(2)} / mile will be charged for miles driven over this allotment.`}
                />
            </section>

            {/* ── Price ───────────────────────────────────────────────────── */}
            <section className="space-y-3 px-6 py-6 sm:px-8">
                {quote ? (
                    <>
                        {/* Row order mirrors the arithmetic in calculateTripPrice,
                            so the column reads top to bottom as the total being
                            built: the rate, then what comes off it, then what goes
                            on top. Every label comes off the quote rather than
                            being typed here, so a change to DISCOUNT_TIERS or
                            REFUNDABLE_SURCHARGE reaches this page for free. */}
                        {/* The day rows are a two-column list of their own rather
                            than a `sub` line, which is right-aligned — so they sit
                            in one indented block under the row they explain, with
                            the distance note closing it. */}
                        <div>
                            <Line label="Trip price" value={formatMoney(quote.subtotal)} />
                            <div className="mt-1.5 space-y-1 pl-0 text-xs text-muted sm:pl-5">
                                <DayBreakdown days={quote.days} />
                                <p>
                                    Distance limited to {MILES_INCLUDED_PER_DAY} miles per day
                                </p>
                            </div>
                        </div>

                        {quote.discountAmount > 0 && (
                            <Line
                                tone="credit"
                                label={`${quote.discountLabel} (${formatPercent(quote.discountPercent)})`}
                                value={`−${formatMoney(quote.discountAmount)}`}
                            />
                        )}

                        {quote.extraDiscountAmount > 0 && (
                            <Line
                                tone="credit"
                                label={`${quote.extraDiscountLabel} (${formatPercent(quote.extraDiscountPercent)})`}
                                value={`−${formatMoney(quote.extraDiscountAmount)}`}
                            />
                        )}

                        {quote.surchargeAmount > 0 && (
                            <Line
                                label={`${quote.surchargeLabel} (${formatPercent(quote.surchargePercent)})`}
                                value={`+${formatMoney(quote.surchargeAmount)}`}
                            />
                        )}

                        {/* The sign flip described at the top of this file. */}
                        {quote.refundableSurchargeAmount > 0 && (
                            <Line
                                label={quote.refundableSurchargeLabel}
                                value={`+${formatMoney(quote.refundableSurchargeAmount)}`}
                            />
                        )}

                        {/* Last before the total, and the only line with no
                            percentage beside it. Delivery is a flat charge the
                            duration discounts deliberately don't touch, so
                            printing it above them would imply it had been
                            discounted along with the rate. */}
                        {quote.pickupFee > 0 && (
                            <Line
                                label={quote.pickupFeeLabel}
                                value={`+${formatMoney(quote.pickupFee)}`}
                            />
                        )}
                    </>
                ) : (
                    // A booking made before bookings.price_quote existed. There
                    // is no snapshot to itemise and recomputing one would price
                    // the trip against today's rates — see src/lib/receipt.ts.
                    <p className="text-sm text-muted">
                        An itemised breakdown isn't available for this booking.
                    </p>
                )}

                <div className="pt-3">
                    <Line
                        weight="bold"
                        label={wasCharged ? 'Trip total' : 'Trip total (not yet charged)'}
                        value={formatMoney(receipt.totalCharged)}
                    />
                </div>

                {wasRefunded && (
                    <div className="space-y-3 border-t border-line pt-3">
                        <Line
                            tone="credit"
                            label="Refunded"
                            value={`−${formatMoney(receipt.refundedAmount)}`}
                        />
                        <Line
                            weight="bold"
                            label="Net charged"
                            value={formatMoney(receipt.netCharged)}
                        />
                    </div>
                )}
            </section>

            {/* ── Footer ──────────────────────────────────────────────────── */}
            <footer className="space-y-3 border-t border-line bg-page px-6 py-5 text-xs text-muted sm:px-8">
                {notice && <p className="font-semibold text-ink">{notice}</p>}

                {card?.last4 && (
                    <p>
                        Paid with <span className="capitalize">{card.brand ?? 'card'}</span> ····{' '}
                        {card.last4}
                    </p>
                )}

                <p>
                    Subject to change in the event of additional fees and/or refunds during or
                    after the trip.
                </p>

                {/* Kept, but demoted to what it actually is. This link used to be
                    the guest's only "receipt" — a Stripe charge page that knows
                    about a card and nothing about a trip. */}
                {card?.receiptUrl && (
                    <a
                        href={card.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block font-semibold text-pine-500 hover:underline print:hidden"
                    >
                        Card payment receipt from Stripe →
                    </a>
                )}
            </footer>
        </article>
    )
}