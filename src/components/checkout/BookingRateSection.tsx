import { useState } from 'react'
import {
    FREE_CANCELLATION_HOURS,
    bookingRateLabel,
    freeCancellationDeadline,
    type BookingRate,
} from '@/lib/booking-rate.ts'
import { effectiveFreeCancellationDeadline } from '@/lib/cancellation-policy.ts'
import { formatBusinessDate, formatBusinessDateTime } from '@/lib/dates.ts'
import { RadioDot } from './RadioDot'
import { BookingRateInfoModal } from './BookingRateInfoModal'

const formatMoney = (amount: number): string => `$${amount.toFixed(2)}`

export function BookingRateSection({
    value,
    onChange,
    tripStart,
    totals,
    disabled = false,
}: {
    value: BookingRate
    onChange: (rate: BookingRate) => void
    /** Trip start, used only for the refundable option's free-cancel deadline. */
    tripStart: Date
    /** What each option costs — both quoted by calculateTripPrice upstream, so
     *  the two prices differ only by the rate and cannot drift apart. */
    totals: Record<BookingRate, number>
    disabled?: boolean
}) {
    const [showInfo, setShowInfo] = useState(false)

    // Measured from the trip, not from now, so it doesn't tick over while the
    // page is open. bookedAt is unused for the refundable rate but the helper
    // takes both ends, so pass something honest rather than a placeholder.
    const refundableDeadline = freeCancellationDeadline('refundable', {
        bookedAt: new Date(),
        tripStart,
    })

    // The non-refundable window is NOT a flat 24 hours. It's capped so it can
    // never outlast the refundable one — otherwise the cheaper rate would be
    // more forgiving than the one being upsold, which is what happens on any
    // booking made less than ~48h ahead. See effectiveFreeCancellationDeadline.
    //
    // So the deadline is shown as a date rather than a duration. On a trip
    // booked well in advance it lands 24h from now and reads as before; on a
    // same-day booking it lands an hour out, and saying "24 hours" there would
    // be a promise this code does not keep.
    const nonRefundableDeadline = effectiveFreeCancellationDeadline('non-refundable', {
        bookedAt: new Date(),
        tripStart,
    })
    const shortWindow =
        nonRefundableDeadline.getTime() - Date.now() < FREE_CANCELLATION_HOURS * 60 * 60 * 1000 - 60_000

    return (
        <div className="mb-8">
            <h2 className="text-2xl font-bold text-ink mb-4">Booking rate</h2>

            <div className="bg-surface border border-line rounded-2xl divide-y divide-line shadow-sm">
                {(['non-refundable', 'refundable'] as const).map((rate) => {
                    const checked = value === rate
                    return (
                        <label
                            key={rate}
                            className={`flex items-start gap-3 p-4 ${
                                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                            }`}
                        >
                            <input
                                type="radio"
                                name="bookingRate"
                                className="sr-only"
                                checked={checked}
                                onChange={() => onChange(rate)}
                                disabled={disabled}
                            />
                            <RadioDot checked={checked} />

                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-baseline gap-4">
                                    <span className="text-ink font-medium">
                                        {bookingRateLabel(rate)}
                                    </span>
                                    <span className="font-bold text-ink tabular-nums whitespace-nowrap">
                                        {formatMoney(totals[rate])}
                                    </span>
                                </div>

                                {rate === 'non-refundable' ? (
                                    <>
                                        <p className="text-sm text-muted mt-1">
                                            {shortWindow ? (
                                                <>
                                                    Cancel for free until{' '}
                                                    {formatBusinessDateTime(nonRefundableDeadline)}.
                                                </>
                                            ) : (
                                                <>Cancel for free for {FREE_CANCELLATION_HOURS} hours.</>
                                            )}{' '}
                                            After that, the trip is non-refundable.
                                        </p>
                                        {/* Not nested in the <label>'s click
                                            target by accident — stopPropagation
                                            keeps opening the modal from also
                                            selecting this option. */}
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                setShowInfo(true)
                                            }}
                                            className="mt-1.5 text-sm text-muted underline hover:no-underline cursor-pointer"
                                        >
                                            Learn more
                                        </button>
                                    </>
                                ) : (
                                    // No "$0 due now" claim here: checkout charges
                                    // in full on the next step, and deferred
                                    // payment doesn't exist yet.
                                    <p className="text-sm text-muted mt-1">
                                        Cancel for free before{' '}
                                        {formatBusinessDate(refundableDeadline, {
                                            month: 'short',
                                            day: 'numeric',
                                        })}
                                        .
                                    </p>
                                )}
                            </div>
                        </label>
                    )
                })}
            </div>

            {showInfo && <BookingRateInfoModal onClose={() => setShowInfo(false)} />}
        </div>
    )
}