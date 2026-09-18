import { CalendarDays, MapPin, Tag } from 'lucide-react'
import type { TripQuote } from '@/lib/pricing.ts'
import { timeToMinutes } from '@/lib/pricing.ts'
import { formatDateKey, formatMinutesOfDay } from '@/lib/dates.ts'
import type { CheckoutSearch } from '@/lib/checkout-search.ts'
import { distanceFeeForTrip, formatMiles, milesIncluded } from '@/lib/distance.ts'
import type { Car } from '@/types.ts'
import { carMainImageUrl } from '@/lib/car-images.ts'

// ── Placeholder ───────────────────────────────────────────────────────────────
//
// Sales tax isn't real yet, and isn't part of any charge. The Trip total below
// is `total`, which is the server's quote — the exact amount the PaymentIntent
// is created for. It's printed at $0.00 rather than omitted so the row exists
// and has an obvious home once a rate is settled on.
//
// If it's ever made real it belongs in calculateTripPrice (src/lib/pricing.ts),
// not here, so that the widget, the server quote, the PaymentIntent and
// bookings.total_price all move together.
const PLACEHOLDER_SALES_TAX = 0

const formatMoney = (amount: number): string => `$${amount.toFixed(2)}`

const formatPercent = (percent: number): string => `${Math.round(percent * 100)}%`

// "Fri, Sep 4 at 10:00 AM".
//
// formatDateKey, not `new Date(...)`: these are 'YYYY-MM-DD' search params with
// no instant in them, and the Date constructor reads a date-only string as UTC
// midnight — which renders as the day before in every US timezone. That's what
// made this summary disagree with both the picker the customer just used and
// the dates the server actually booked.
function formatWhen(dateKey: string, time: string): string {
    const day = formatDateKey(dateKey, { weekday: 'short', month: 'short', day: 'numeric' })
    return `${day} at ${formatMinutesOfDay(timeToMinutes(time))}`
}

function Row({
    label,
    value,
    tone = 'default',
}: {
    label: React.ReactNode
    value: React.ReactNode
    tone?: 'default' | 'green'
}) {
    return (
        <div className="flex justify-between items-baseline gap-4 text-sm">
            <span className={tone === 'green' ? 'text-pine-700' : 'text-muted'}>{label}</span>
            <span
                className={`font-medium tabular-nums whitespace-nowrap ${
                    tone === 'green' ? 'text-pine-700' : 'text-ink'
                }`}
            >
                {value}
            </span>
        </div>
    )
}

export function TripSummaryCard({
    car,
    carId,
    search,
    quote,
    total,
}: {
    car: Car
    carId: string
    search: CheckoutSearch
    quote: TripQuote
    /** What the customer is actually charged — the server's total once it has
     *  arrived, the local quote before that. */
    total: number
}) {
    const savings = quote.discountAmount + quote.extraDiscountAmount

    return (
        <div className="bg-surface border border-line rounded-2xl p-5 shadow-sm">
            {/* ── Car ─────────────────────────────────────────────────────── */}
            <div className="flex gap-4 items-start">
                <div className="flex-1 min-w-0">
                    <p className="font-bold text-ink leading-tight">
                        {/* trim is nullable — filter rather than interpolate, so a
                            car without one doesn't render a trailing space. */}
                        {[car.make, car.model, car.trim].filter(Boolean).join(' ')}
                    </p>
                    <p className="text-muted text-sm mt-0.5">{car.year}</p>
                </div>
                <img
                    src={carMainImageUrl(carId)}
                    alt={`${car.year} ${car.make} ${car.model}`}
                    className="w-24 h-16 object-cover rounded-lg flex-shrink-0"
                    loading="lazy"
                    decoding="async"
                />
            </div>

            {/* ── When & where ────────────────────────────────────────────── */}
            <div className="mt-5 space-y-3">
                <div className="flex gap-3">
                    <CalendarDays size={18} className="text-ink-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-ink leading-relaxed">
                        <p>{formatWhen(search.startDate, search.startTime)}</p>
                        <p>{formatWhen(search.endDate, search.endTime)}</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <MapPin size={18} className="text-ink-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-ink">{search.pickupLocation}</p>
                </div>
            </div>

            {/* ── Price breakdown ─────────────────────────────────────────── */}
            {/* Row order mirrors the arithmetic in calculateTripPrice, so the
                column reads top to bottom as the total being built: subtotal,
                then what comes off it, then what goes on top. */}
            <div className="mt-5 pt-5 border-t border-line space-y-2.5">
                <Row
                    label={`${quote.billableDays} ${quote.billableDays === 1 ? 'day' : 'days'}`}
                    value={formatMoney(quote.subtotal)}
                />

                {quote.discountAmount > 0 && (
                    <Row
                        tone="green"
                        label={`${quote.discountLabel} (${formatPercent(quote.discountPercent)})`}
                        value={`−${formatMoney(quote.discountAmount)}`}
                    />
                )}

                {quote.extraDiscountAmount > 0 && (
                    <Row
                        tone="green"
                        label={`${quote.extraDiscountLabel} (${formatPercent(quote.extraDiscountPercent)})`}
                        value={`−${formatMoney(quote.extraDiscountAmount)}`}
                    />
                )}

                {quote.surchargeAmount > 0 && (
                    <Row
                        label={`${quote.surchargeLabel} (${formatPercent(quote.surchargePercent)})`}
                        value={`+${formatMoney(quote.surchargeAmount)}`}
                    />
                )}

                {quote.refundableSurchargeAmount > 0 && (
                    <Row
                        label={quote.refundableSurchargeLabel}
                        value={`+${formatMoney(quote.refundableSurchargeAmount)}`}
                    />
                )}

                {quote.pickupFee > 0 && (
                    <Row label={quote.pickupFeeLabel} value={`+${formatMoney(quote.pickupFee)}`} />
                )}

                <Row label="Sales tax" value={formatMoney(PLACEHOLDER_SALES_TAX)} />

                {/* Not a price line — it sits below Sales tax and above the
                    Trip total divider, and never enters the total. The overage
                    is settled after the trip against a real odometer reading. */}
                <div>
                    <Row
                        label="Distance included"
                        value={`${formatMiles(milesIncluded(quote.billableDays))} miles`}
                    />
                    <p className="text-xs text-muted mt-1">
                        ${distanceFeeForTrip(car, quote, Number(car.price_per_day)).toFixed(2)} /
                        mile will be charged for miles driven over this allotment.
                    </p>
                </div>
            </div>

            {/* ── Total ───────────────────────────────────────────────────── */}
            <div className="mt-5 pt-5 border-t border-line flex justify-between items-baseline">
                <span className="font-bold text-ink">Trip total</span>
                <span className="text-xl font-bold text-ink tabular-nums">
                    {formatMoney(total)}
                </span>
            </div>

            {savings > 0 && (
                <div className="mt-5 flex gap-3 items-start bg-pine-50 rounded-xl p-4">
                    <Tag size={18} className="text-pine-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-pine-700">
                            You're saving {formatMoney(savings)}
                        </p>
                        <p className="text-xs text-pine-700/80 mt-0.5">
                            {[quote.discountLabel, quote.extraDiscountLabel]
                                .filter(Boolean)
                                .join(' and ')}{' '}
                            applied.
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}