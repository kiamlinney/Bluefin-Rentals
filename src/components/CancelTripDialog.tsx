import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cancelBooking, previewCancellation } from '@/lib/db.ts'
import type { RefundOutcome } from '@/lib/cancellation-policy.ts'

// The guest's cancel flow, replacing the inline "Are you sure? / Yes / Back"
// that used to sit on the card.
//
// It got promoted to a dialog because the question changed. It used to be
// "confirm you meant to click that", which a two-button row answers fine. Now
// the guest has to be told how much money they are about to lose — an amount
// that depends on their rate and on what time it is — and offered a reason box.
// That does not fit on a card row, and burying a partial refund in one would be
// the kind of thing people file chargebacks over.
//
// Modal mechanics follow BookingRateInfoModal (no portal, fixed backdrop,
// Escape to close, clicks inside stopped from reaching the backdrop), plus the
// focus restore and scroll lock from TripMediaLightbox — this one takes typed
// input, so losing focus to the page behind it is worse here than there.

const MAX_REASON = 500

const inputClass =
    'w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-ink text-sm ' +
    'placeholder:text-ink-400 focus:outline-none focus:border-brand hover:border-ink-400 transition-colors resize-none'

/** The money sentence. Deliberately blunt when the answer is "nothing". */
function RefundSummary({ outcome, totalPaid }: { outcome: RefundOutcome; totalPaid: number }) {
    const fmt = (n: number) => `$${n.toFixed(2)}`

    if (outcome.kind === 'full') {
        return (
            <div className="rounded-lg border border-pine-500 bg-pine-500/10 px-4 py-3">
                <p className="text-sm font-bold text-pine-700">You'll be refunded {fmt(outcome.refundAmount)}</p>
                <p className="text-xs text-muted mt-1">
                    This trip is within its free cancellation window, so you get the full amount back.
                </p>
            </div>
        )
    }

    if (outcome.kind === 'partial') {
        return (
            <div className="rounded-lg border border-amber-600 bg-amber-50 px-4 py-3">
                <p className="text-sm font-bold text-ink">You'll be refunded {fmt(outcome.refundAmount)}</p>
                <p className="text-xs text-muted mt-1">
                    This trip is past its free cancellation window, so a cancellation fee is kept.
                </p>
                <dl className="mt-3 space-y-1 border-t border-amber-600/40 pt-2 text-xs text-ink">
                    <div className="flex justify-between">
                        <dt>Trip total</dt>
                        <dd className="tabular-nums">{fmt(totalPaid)}</dd>
                    </div>
                    <div className="flex justify-between">
                        <dt>Cancellation fee</dt>
                        <dd className="tabular-nums">−{fmt(outcome.cancellationFee)}</dd>
                    </div>
                    {outcome.retainedPremium > 0 && (
                        <div className="flex justify-between text-muted">
                            <dt>Refundable rate</dt>
                            <dd className="tabular-nums">−{fmt(outcome.retainedPremium)}</dd>
                        </div>
                    )}
                    <div className="flex justify-between font-bold text-ink border-t border-amber-600/40 pt-1">
                        <dt>Refunded</dt>
                        <dd className="tabular-nums">{fmt(outcome.refundAmount)}</dd>
                    </div>
                </dl>
            </div>
        )
    }

    // The one the guest must not be able to miss.
    return (
        <div className="rounded-lg border border-red-700 bg-red-50 px-4 py-3">
            <p className="text-sm font-bold text-red-800">You will not be refunded</p>
            <p className="text-xs text-muted mt-1">
                {outcome.reason === 'after-trip-start'
                    ? 'This trip has already started, so no refund is issued if you cancel.'
                    : outcome.reason === 'non-refundable'
                        ? 'This trip was booked at the non-refundable rate and the 24-hour grace period has passed, so cancelling returns nothing.'
                        : 'Cancelling this trip does not return any money.'}
            </p>
        </div>
    )
}

export function CancelTripDialog({
    bookingId,
    totalPaid,
    onClose,
    onCanceled,
}: {
    bookingId: string
    totalPaid: number
    onClose: () => void
    onCanceled: () => void
}) {
    const [preview, setPreview] = useState<{ outcome: RefundOutcome; wasCharged: boolean } | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [reason, setReason] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const overlayRef = useRef<HTMLDivElement>(null)
    const openerRef = useRef<Element | null>(null)

    // Escape closes, but never mid-request: cancelBooking is already in flight
    // at that point and dismissing the dialog would leave the guest with no idea
    // whether it went through.
    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape' && !working) onClose()
        }
        document.addEventListener('keydown', handleKey)
        return () => document.removeEventListener('keydown', handleKey)
    }, [onClose, working])

    // Focus in, and back out to whatever opened this on the way home.
    useEffect(() => {
        openerRef.current = document.activeElement
        overlayRef.current?.focus()
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = previousOverflow
            if (openerRef.current instanceof HTMLElement) openerRef.current.focus()
        }
    }, [])

    // Asked of the server rather than computed here, so the figure shown is the
    // one the server will act on. See previewCancellation.
    useEffect(() => {
        let live = true
        previewCancellation({ data: { bookingId } })
            .then(result => {
                if (live) setPreview({ outcome: result.outcome as RefundOutcome, wasCharged: result.wasCharged })
            })
            .catch(() => {
                if (live) setLoadError("We couldn't work out the refund for this trip. Please contact us.")
            })
        return () => { live = false }
    }, [bookingId])

    const handleCancel = async () => {
        setWorking(true)
        setError(null)
        try {
            await cancelBooking({ data: { bookingId, reason: reason.trim() || undefined } })
            onCanceled()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not cancel this trip. Please contact us.')
            setWorking(false)
        }
    }

    return (
        <div
            ref={overlayRef}
            tabIndex={-1}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
            onClick={e => { if (e.target === e.currentTarget && !working) onClose() }}
        >
            <div
                className="w-full max-w-md bg-surface text-ink rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cancel-trip-title"
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-line">
                    <h2 id="cancel-trip-title" className="text-lg font-bold text-ink">Cancel this trip?</h2>
                    <button
                        onClick={onClose}
                        disabled={working}
                        aria-label="Close"
                        className="p-1.5 -mr-1.5 rounded-full hover:bg-subtle transition-colors cursor-pointer disabled:opacity-50"
                    >
                        <X size={20} className="text-muted" />
                    </button>
                </div>

                <div className="px-6 py-4 overflow-y-auto space-y-4">
                    {loadError ? (
                        <p className="text-sm text-red-700">{loadError}</p>
                    ) : !preview ? (
                        <p className="text-sm text-muted">Working out your refund…</p>
                    ) : (
                        <>
                            {preview.wasCharged ? (
                                <RefundSummary outcome={preview.outcome} totalPaid={totalPaid} />
                            ) : (
                                <div className="rounded-lg border border-line bg-subtle px-4 py-3">
                                    <p className="text-sm font-bold text-ink">Nothing has been charged</p>
                                    <p className="text-xs text-muted mt-1">
                                        This booking was never paid for, so there's nothing to refund.
                                    </p>
                                </div>
                            )}

                            {preview.outcome.estimated && preview.wasCharged && (
                                <p className="text-xs text-muted">
                                    This booking predates itemised pricing, so the refund above is calculated
                                    from the trip total.
                                </p>
                            )}

                            <div>
                                <label htmlFor="cancel-reason" className="block text-sm font-medium text-ink mb-1.5">
                                    Reason for cancelling <span className="text-muted font-normal">(optional)</span>
                                </label>
                                <textarea
                                    id="cancel-reason"
                                    rows={3}
                                    maxLength={MAX_REASON}
                                    value={reason}
                                    onChange={e => setReason(e.target.value)}
                                    disabled={working}
                                    placeholder="Let us know what happened — this goes straight to us."
                                    className={inputClass}
                                />
                                <p className="text-xs text-ink-400 mt-1 text-right">
                                    {reason.length}/{MAX_REASON}
                                </p>
                            </div>

                            {error && <p className="text-sm text-red-700">{error}</p>}
                        </>
                    )}
                </div>

                <div className="border-t border-line px-6 py-4 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={working}
                        className="px-4 py-2.5 rounded-lg text-sm font-semibold text-muted hover:bg-subtle transition-colors cursor-pointer disabled:opacity-50"
                    >
                        Keep my trip
                    </button>
                    <button
                        onClick={handleCancel}
                        disabled={working || !preview}
                        className="px-6 py-2.5 rounded-lg bg-red-700 text-white text-sm font-semibold hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-50"
                    >
                        {working ? 'Cancelling…' : 'Cancel trip'}
                    </button>
                </div>
            </div>
        </div>
    )
}