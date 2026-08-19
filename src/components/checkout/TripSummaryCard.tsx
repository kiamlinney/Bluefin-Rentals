import { CalendarDays, MapPin, Tag } from 'lucide-react'
import type { TripQuote } from '@/lib/pricing.ts'
import { timeToMinutes } from '@/lib/pricing.ts'
import { formatDateKey, formatMinutesOfDay } from '@/lib/dates.ts'
import type { CheckoutSearch } from '@/lib/checkout-search.ts'
import type { Car } from '@/types.ts'

// ── Placeholders ──────────────────────────────────────────────────────────────
//
// Neither of these is real yet, and neither is part of any charge. The Trip
// total below is `total`, which is the server's quote — the exact amount the
// PaymentIntent is created for. Sales tax is printed at $0.00 rather than
// omitted so the row exists and has an obvious home once a rate is settled on;
// the mileage allowance is a flat number for the same reason.
//
// If sales tax is ever made real it belongs in calculateTripPrice
// (src/lib/pricing.ts), not here, so that the widget, the server quote, the
// PaymentIntent and bookings.total_price all move together.
const PLACEHOLDER_SALES_TAX = 0
const PLACEHOLDER_DISTANCE_MILES = 600
const PLACEHOLDER_PER_MILE_FEE = 0.31

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
            <span className={tone === 'green' ? 'text-[#2a4a1e]' : 'text-gray-700'}>{label}</span>
            <span
                className={`font-medium tabular-nums whitespace-nowrap ${
                    tone === 'green' ? 'text-[#2a4a1e]' : 'text-gray-900'
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
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            {/* ── Car ─────────────────────────────────────────────────────── */}
            <div className="flex gap-4 items-start">
                <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 leading-tight">
                        {/* trim is nullable — filter rather than interpolate, so a
                            car without one doesn't render a trailing space. */}
                        {[car.make, car.model, car.trim].filter(Boolean).join(' ')}
                    </p>
                    <p className="text-gray-500 text-sm mt-0.5">{car.year}</p>
                </div>
                <img
                    src={`https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${carId}/main.PNG`}
                    alt={`${car.year} ${car.make} ${car.model}`}
                    className="w-24 h-16 object-cover rounded-lg flex-shrink-0"
                />
            </div>

            {/* ── When & where ────────────────────────────────────────────── */}
            <div className="mt-5 space-y-3">
                <div className="flex gap-3">
                    <CalendarDays size={18} className="text-gray-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-gray-900 leading-relaxed">
                        <p>{formatWhen(search.startDate, search.startTime)}</p>
                        <p>{formatWhen(search.endDate, search.endTime)}</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <MapPin size={18} className="text-gray-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-gray-900">{search.pickupLocation}</p>
                </div>
            </div>

            {/* ── Price breakdown ─────────────────────────────────────────── */}
            {/* Row order mirrors the arithmetic in calculateTripPrice, so the
                column reads top to bottom as the total being built: subtotal,
                then what comes off it, then what goes on top. */}
            <div className="mt-5 pt-5 border-t border-gray-200 space-y-2.5">
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

                {quote.pickupFee > 0 && (
                    <Row label={quote.pickupFeeLabel} value={`+${formatMoney(quote.pickupFee)}`} />
                )}

                <Row label="Sales tax" value={formatMoney(PLACEHOLDER_SALES_TAX)} />

                <div>
                    <Row
                        label="Distance included"
                        value={`${PLACEHOLDER_DISTANCE_MILES} miles`}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        ${PLACEHOLDER_PER_MILE_FEE.toFixed(2)} / mile will be charged for miles
                        driven over this allotment.
                    </p>
                </div>
            </div>

            {/* ── Total ───────────────────────────────────────────────────── */}
            <div className="mt-5 pt-5 border-t border-gray-200 flex justify-between items-baseline">
                <span className="font-bold text-gray-900">Trip total</span>
                <span className="text-xl font-bold text-gray-900 tabular-nums">
                    {formatMoney(total)}
                </span>
            </div>

            {savings > 0 && (
                <div className="mt-5 flex gap-3 items-start bg-[#eef5e9] rounded-xl p-4">
                    <Tag size={18} className="text-[#3a7d2c] flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-[#2a4a1e]">
                            You're saving {formatMoney(savings)}
                        </p>
                        <p className="text-xs text-[#2a4a1e]/80 mt-0.5">
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