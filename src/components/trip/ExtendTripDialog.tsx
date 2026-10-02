import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { finishChargePayment, quoteTripExtension, requestTripExtension } from '@/lib/payments'
import { stripePromise } from '@/lib/stripe-client'
import { BUSINESS_CLOSE_MINUTES, BUSINESS_OPEN_MINUTES, SLOT_MINUTES } from '@/lib/availability'
import { EXTENSION_REQUEST_CUTOFF_MINUTES } from '@/lib/extension'
import { displayTaxLines } from '@/lib/tax'
import { businessDateKey, formatBusinessDateTime, formatMinutesOfDay } from '@/lib/dates'
import { DialogError, ModalShell, Money, dialogInputClass, primaryButtonClass, secondaryButtonClass } from './ModalShell'

// Extending a trip (ImportantFiles/extensions.md).
//
// Every figure shown is the server's: quoteTripExtension runs the exact function
// requestTripExtension charges with, so the preview is the price. Nothing about
// the price is sent back up — only the new end.

type Preview = Awaited<ReturnType<typeof quoteTripExtension>>

const TIME_OPTIONS: { value: string; label: string }[] = (() => {
    const options = []
    for (let m = BUSINESS_OPEN_MINUTES; m <= BUSINESS_CLOSE_MINUTES; m += SLOT_MINUTES) {
        options.push({ value: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, label: formatMinutesOfDay(m) })
    }
    return options
})()

export function ExtendTripDialog({
    bookingId,
    currentEnd,
    onClose,
    onDone,
}: {
    bookingId: string
    currentEnd: string
    onClose: () => void
    onDone: (message: string) => void
}) {
    const minDate = useMemo(() => businessDateKey(currentEnd), [currentEnd])
    const [date, setDate] = useState(minDate)
    const [time, setTime] = useState('')
    const [preview, setPreview] = useState<Preview | null>(null)
    const [quoting, setQuoting] = useState(false)
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [payLinkChargeId, setPayLinkChargeId] = useState<string | null>(null)

    // Re-quote whenever the choice changes. Stale answers are dropped so a slow
    // response can't overwrite the price for a newer choice.
    useEffect(() => {
        if (!date || !time) {
            setPreview(null)
            return
        }
        let current = true
        setQuoting(true)
        setError(null)
        quoteTripExtension({ data: { bookingId, newEndDate: date, newEndTime: time } })
            .then(p => { if (current) setPreview(p) })
            .catch((e: unknown) => {
                if (!current) return
                setPreview(null)
                setError(e instanceof Error ? e.message : 'Could not price that extension.')
            })
            .finally(() => { if (current) setQuoting(false) })
        return () => { current = false }
    }, [bookingId, date, time])

    const confirm = async () => {
        if (!preview) return
        setWorking(true)
        setError(null)
        try {
            const result = await requestTripExtension({ data: { bookingId, newEndDate: date, newEndTime: time } })
            let extension = result.extension

            if (result.needsAction && result.clientSecret && extension.charge_id) {
                const stripe = await stripePromise
                if (!stripe) throw new Error('Could not load the payment form.')
                const { error: actionError } = await stripe.handleNextAction({ clientSecret: result.clientSecret })
                const finished = await finishChargePayment({ data: { bookingId, chargeId: extension.charge_id } })
                if (finished.extension) extension = finished.extension
                if (actionError) {
                    setPayLinkChargeId(extension.charge_id)
                    throw new Error(actionError.message ?? 'Your bank did not approve the payment.')
                }
            } else if (result.error) {
                if (extension.charge_id) setPayLinkChargeId(extension.charge_id)
                throw new Error(result.error)
            }

            const newEnd = formatBusinessDateTime(extension.to_end_time)
            if (extension.status === 'confirmed') {
                onDone(`Your trip now ends ${newEnd}.`)
            } else if (extension.status === 'requested') {
                onDone(`Request sent. Your card is held for $${Number(extension.amount).toFixed(2)} until Bluefin answers; nothing is charged if they decline.`)
            } else {
                onDone('Your extension is being processed. This page will update.')
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'The extension did not go through.')
            setWorking(false)
        }
    }

    const quote = preview?.quote

    return (
        <ModalShell
            title="Extend your trip"
            onClose={onClose}
            busy={working}
            footer={
                <>
                    <button type="button" onClick={onClose} disabled={working} className={secondaryButtonClass}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={confirm}
                        disabled={!preview || quoting || working}
                        className={primaryButtonClass}
                    >
                        {working
                            ? 'Working…'
                            : !preview
                                ? 'Extend trip'
                                : preview.mode === 'request'
                                    ? `Request · hold $${preview.total.toFixed(2)}`
                                    : preview.total > 0
                                        ? `Extend · pay $${preview.total.toFixed(2)}`
                                        : 'Extend · no charge'}
                    </button>
                </>
            }
        >
            <p className="text-sm text-muted">
                Your trip ends {formatBusinessDateTime(currentEnd)}. Choose a new return time. If the car
                is free the whole way, the extension is confirmed straight away and charged to your card
                on file.
            </p>

            <div className="grid grid-cols-2 gap-3">
                <label className="block">
                    <span className="block text-sm font-semibold text-ink mb-1.5">Return date</span>
                    <input
                        type="date"
                        className={dialogInputClass}
                        min={minDate}
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        disabled={working}
                    />
                </label>
                <label className="block">
                    <span className="block text-sm font-semibold text-ink mb-1.5">Return time</span>
                    <select
                        className={dialogInputClass}
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        disabled={working}
                    >
                        <option value="">Select time</option>
                        {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </label>
            </div>

            {quoting && <p className="text-sm text-muted">Checking availability and price…</p>}

            {preview && quote && !quoting && (
                <div className="border border-line rounded-xl p-4 space-y-2 text-sm">
                    {preview.mode === 'request' && (
                        <p className="text-ink bg-subtle rounded-lg p-3">
                            Your trip ends within {EXTENSION_REQUEST_CUTOFF_MINUTES} minutes, so this is sent to
                            Bluefin as a request. Your card is held for the amount below and only charged if
                            they approve.
                        </p>
                    )}
                    {quote.days.length === 0 ? (
                        <p className="text-muted">
                            The extra time falls inside a day you've already paid for, so there's nothing to
                            charge.
                        </p>
                    ) : (
                        <>
                            <Row label={`${quote.days.length} added ${quote.days.length === 1 ? 'day' : 'days'}`} amount={quote.subtotal} />
                            {quote.discountAmount > 0 && <Row label={quote.discountLabel ?? 'Discount'} amount={-quote.discountAmount} />}
                            {quote.extraDiscountAmount > 0 && <Row label={quote.extraDiscountLabel ?? 'Discount'} amount={-quote.extraDiscountAmount} />}
                            {quote.refundableSurchargeAmount > 0 && <Row label={quote.refundableSurchargeLabel ?? 'Refundable rate'} amount={quote.refundableSurchargeAmount} />}
                            {quote.extras.map(extra => (
                                <Row key={extra.id} label={`${extra.name} (${extra.quantity} days)`} amount={extra.amount} />
                            ))}
                            {displayTaxLines(preview.taxLines).map(tax =><Row key={tax.id} label={tax.label} amount={tax.amount} />)}
                            <div className="border-t border-line pt-2 flex justify-between font-bold text-ink">
                                <span>Total</span>
                                <Money amount={preview.total} />
                            </div>
                        </>
                    )}
                </div>
            )}

            <DialogError message={error} />

            {payLinkChargeId && (
                <Link
                    to="/trips/$bookingId/pay/$chargeId"
                    params={{ bookingId, chargeId: payLinkChargeId }}
                    className="block text-sm font-semibold text-pine-500 hover:underline"
                >
                    Pay with a different card →
                </Link>
            )}
        </ModalShell>
    )
}

function Row({ label, amount }: { label: string; amount: number }) {
    return (
        <div className="flex justify-between gap-4">
            <span className="text-muted">{label}</span>
            <Money amount={amount} className="text-ink" />
        </div>
    )
}