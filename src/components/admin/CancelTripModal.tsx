import { useEffect, useState } from 'react'
import { cancelBooking, previewCancellation } from '@/lib/db'
import { money } from '@/lib/email-template'
import { cn } from '@/lib/utils'
import {
    DialogError,
    ModalShell,
    dialogInputClass,
    secondaryButtonClass,
} from '@/components/trip/ModalShell'

// An owner cancelling from the reservation page. It replaced an inline
// "Cancel and refund…? Yes / Back" row in the countdown card, which had no
// room to say where the money goes and no reason box.
//
// Two different actions sit behind the one button, so the dialog says which is
// about to happen:
//
// - A confirmed trip. A cancellation by us always refunds in full: the guest's
//   rate and free window only govern what *they* get back when *they* cancel.
//   Worth spelling out, since the page shows the guest's policy right above.
//   The figure comes from previewCancellation, the same rule cancelBooking
//   pays, so the button can't promise one amount while Stripe refunds another.
// - A pending hold. Never charged, so nothing is refunded and nobody is
//   emailed. cancelBooking marks it expired and it drops off the guest's list.

const MAX_REASON = 500

const dangerButtonClass =
    'px-4 py-2.5 rounded-xl bg-red-700 text-white text-sm font-bold whitespace-nowrap hover:bg-red-800 transition-colors ' +
    'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'

/** `asBusiness` is false for an owner's own booking: then the guest's terms apply. */
type Preview = { tripRefund: number; laterRefund: number; asBusiness: boolean }

export function CancelTripModal({
    bookingId,
    isHold,
    guestName,
    rateLabel,
    onClose,
    onCanceled,
}: {
    bookingId: string
    /** A pending checkout rather than a paid trip. */
    isHold: boolean
    guestName: string
    /** The guest's booking rate, e.g. "Non-refundable". */
    rateLabel: string
    onClose: () => void
    onCanceled: () => Promise<void> | void
}) {
    const [preview, setPreview] = useState<Preview | null>(null)
    const [reason, setReason] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [stale, setStale] = useState(false)

    useEffect(() => {
        if (isHold) return
        let live = true
        previewCancellation({ data: { bookingId } })
            .then(result => {
                if (!live) return
                // The page was opened while the trip was confirmed, but it no
                // longer is: cancelled from another tab, or by the guest. The
                // preview would still price a refund, and quoting one here
                // would describe money that isn't going to move.
                if (!result.wasCharged) setStale(true)
                else setPreview({ tripRefund: result.outcome.refundAmount, laterRefund: result.laterRefund, asBusiness: result.byAdmin })
            })
            .catch((e: unknown) => {
                if (live) setError(e instanceof Error ? e.message : 'Could not work out the refund.')
            })
        return () => { live = false }
    }, [bookingId, isHold])

    const cancel = async () => {
        setWorking(true)
        setError(null)
        try {
            await cancelBooking({ data: { bookingId, reason: reason.trim() || undefined } })
            await onCanceled()
            onClose()
        } catch (e: unknown) {
            // cancelBooking's errors are specific ("could not process refund
            // through Stripe, nothing was changed"), so they're shown as-is.
            setError(e instanceof Error ? e.message : 'Could not cancel this trip.')
            setWorking(false)
        }
    }

    if (isHold) {
        return (
            <ModalShell
                title="Discard this unpaid hold?"
                busy={working}
                onClose={onClose}
                footer={
                    <>
                        <button type="button" className={secondaryButtonClass} disabled={working} onClick={onClose}>
                            Keep hold
                        </button>
                        <button type="button" className={dangerButtonClass} disabled={working} onClick={cancel}>
                            {working ? 'Discarding…' : 'Discard hold'}
                        </button>
                    </>
                }
            >
                <div className="rounded-xl border border-line bg-subtle px-4 py-3">
                    <p className="text-sm font-bold text-ink">Nothing has been charged</p>
                    <p className="text-xs text-muted mt-1">
                        {guestName} started checking out but never paid, so there's nothing to refund.
                    </p>
                </div>
                <Consequences
                    items={[
                        'Their checkout payment is cancelled, so it can no longer be paid.',
                        'Nobody is emailed.',
                        'The dates go back on sale.',
                    ]}
                />
                <DialogError message={error} />
            </ModalShell>
        )
    }

    if (stale) {
        return (
            <ModalShell
                title="This trip has changed"
                onClose={onClose}
                footer={
                    <button
                        type="button"
                        className={secondaryButtonClass}
                        onClick={async () => { await onCanceled(); onClose() }}
                    >
                        Reload trip
                    </button>
                }
            >
                <p className="text-sm text-ink">
                    This trip is no longer confirmed. It was probably cancelled in another tab or by {guestName}.
                    Nothing has been changed or refunded.
                </p>
            </ModalShell>
        )
    }

    const total = preview ? Math.round((preview.tripRefund + preview.laterRefund) * 100) / 100 : null

    return (
        <ModalShell
            title="Cancel this trip?"
            busy={working}
            onClose={onClose}
            footer={
                <>
                    <button type="button" className={secondaryButtonClass} disabled={working} onClick={onClose}>
                        Keep trip
                    </button>
                    <button
                        type="button"
                        className={dangerButtonClass}
                        disabled={working || total === null}
                        onClick={cancel}
                    >
                        {working ? 'Cancelling…' : total === null ? 'Cancel trip' : `Cancel and refund ${money(total)}`}
                    </button>
                </>
            }
        >
            {total === null ? (
                !error && <p className="text-sm text-muted">Working out the refund…</p>
            ) : (
                <div className="rounded-xl border border-line bg-subtle px-4 py-3">
                    <p className="text-sm font-bold text-ink">{guestName} is refunded {money(total)}</p>
                    <p className="text-xs text-muted mt-1">
                        {preview?.asBusiness === false
                            ? <>This is your own booking, so its {rateLabel.toLowerCase()} terms apply, as for any guest.</>
                            : <>A trip we cancel is refunded in full. Their {rateLabel.toLowerCase()} policy only applies
                                when they cancel.</>}
                    </p>
                    {preview && preview.laterRefund > 0 && (
                        <dl className="mt-3 space-y-1 border-t border-line pt-2 text-xs text-ink">
                            <div className="flex justify-between">
                                <dt>Trip</dt>
                                <dd className="tabular-nums">{money(preview.tripRefund)}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt>Extensions and extras</dt>
                                <dd className="tabular-nums">{money(preview.laterRefund)}</dd>
                            </div>
                            <div className="flex justify-between font-bold border-t border-line pt-1">
                                <dt>Refunded</dt>
                                <dd className="tabular-nums">{money(total)}</dd>
                            </div>
                        </dl>
                    )}
                </div>
            )}

            <Consequences
                items={[
                    'Any deposit hold on their card is released.',
                    'Charges you made (damage, tolls and so on) are not refunded.',
                    `You and ${guestName} are both emailed.`,
                    'The dates go back on sale.',
                ]}
            />

            <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-ink">
                    Reason <span className="font-normal text-muted">(optional, included in {guestName}'s email)</span>
                </span>
                <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={MAX_REASON}
                    rows={3}
                    disabled={working}
                    placeholder="e.g. The car needs a repair that won't be finished before your trip."
                    className={cn(dialogInputClass, 'resize-none')}
                />
            </label>

            <DialogError message={error} />
        </ModalShell>
    )
}

function Consequences({ items }: { items: string[] }) {
    return (
        <ul className="space-y-1.5 text-sm text-ink list-disc pl-5 marker:text-muted">
            {items.map(item => <li key={item}>{item}</li>)}
        </ul>
    )
}
