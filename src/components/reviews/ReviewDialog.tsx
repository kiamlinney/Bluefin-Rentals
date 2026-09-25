import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { createReview, updateReview } from '@/lib/db.ts'
import { REVIEW_BODY_MAX, validateReviewBody } from '@/lib/reviews.ts'
import { formatBusinessDate } from '@/lib/dates.ts'
import type { PublicReview, ReviewableTrip } from '@/types.ts'
import { StarInput } from './Stars.tsx'

// Write or edit a review. Modal mechanics follow CancelTripDialog: no portal,
// fixed backdrop, Escape to close (never mid-request), focus in and back out,
// scroll lock.

const inputClass =
    'w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-ink text-sm ' +
    'placeholder:text-ink-400 focus:outline-none focus:border-brand hover:border-ink-400 transition-colors'

type Props =
    | { mode: 'create'; trips: ReviewableTrip[]; onClose: () => void; onSaved: () => void }
    | { mode: 'edit'; review: PublicReview; onClose: () => void; onSaved: () => void }

function tripLabel(trip: ReviewableTrip) {
    const { year, make, model } = trip.cars
    const range = `${formatBusinessDate(trip.start_time)} – ${formatBusinessDate(trip.end_time)}`
    return `${make} ${model} ${year} · ${range}`
}

export function ReviewDialog(props: Props) {
    const { onClose, onSaved } = props
    const editing = props.mode === 'edit'

    const [bookingId, setBookingId] = useState(props.mode === 'create' ? props.trips[0]?.id ?? '' : '')
    const [rating, setRating] = useState(editing ? props.review.rating : 0)
    const [body, setBody] = useState(editing ? props.review.body : '')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const overlayRef = useRef<HTMLDivElement>(null)
    const openerRef = useRef<Element | null>(null)

    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape' && !working) onClose()
        }
        document.addEventListener('keydown', handleKey)
        return () => document.removeEventListener('keydown', handleKey)
    }, [onClose, working])

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!rating) return setError('Choose a star rating.')
        const checked = validateReviewBody(body)
        if (!checked.ok) return setError(checked.error)

        setWorking(true)
        setError(null)
        try {
            if (props.mode === 'edit') {
                await updateReview({ data: { reviewId: props.review.id, rating, body: checked.body } })
            } else {
                await createReview({ data: { bookingId, rating, body: checked.body } })
            }
            onSaved()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not save your review. Please try again.')
            setWorking(false)
        }
    }

    const car = editing ? props.review.cars : props.trips.find((t) => t.id === bookingId)?.cars

    return (
        <div
            ref={overlayRef}
            tabIndex={-1}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
            onClick={(e) => { if (e.target === e.currentTarget && !working) onClose() }}
        >
            <form
                onSubmit={handleSubmit}
                className="w-full max-w-lg bg-surface text-ink rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
                role="dialog"
                aria-modal="true"
                aria-labelledby="review-dialog-title"
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-line">
                    <h2 id="review-dialog-title" className="text-lg font-bold text-ink">
                        {editing ? 'Edit your review' : 'Review your trip'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={working}
                        aria-label="Close"
                        className="p-1.5 -mr-1.5 rounded-full hover:bg-subtle transition-colors cursor-pointer disabled:opacity-50"
                    >
                        <X size={20} className="text-muted" />
                    </button>
                </div>

                <div className="px-6 py-5 overflow-y-auto space-y-5">
                    {props.mode === 'create' && props.trips.length > 1 ? (
                        <label className="block">
                            <span className="block text-sm font-semibold mb-1.5">Which trip?</span>
                            <select
                                value={bookingId}
                                onChange={(e) => setBookingId(e.target.value)}
                                className={inputClass}
                            >
                                {props.trips.map((trip) => (
                                    <option key={trip.id} value={trip.id}>{tripLabel(trip)}</option>
                                ))}
                            </select>
                        </label>
                    ) : car ? (
                        <p className="text-sm text-muted">
                            {car.make} {car.model} {car.year}
                        </p>
                    ) : null}

                    <div>
                        <span className="block text-sm font-semibold mb-1.5">Your rating</span>
                        <StarInput value={rating} onChange={setRating} />
                    </div>

                    <label className="block">
                        <span className="block text-sm font-semibold mb-1.5">Your review</span>
                        <textarea
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            rows={6}
                            maxLength={REVIEW_BODY_MAX}
                            placeholder="How was the car, pickup and return?"
                            className={`${inputClass} resize-y`}
                        />
                        <span className="block text-right text-xs text-muted mt-1 tabular-nums">
                            {body.length.toLocaleString()} / {REVIEW_BODY_MAX.toLocaleString()}
                        </span>
                    </label>

                    {editing && (
                        <p className="text-xs text-muted">Edited reviews are marked as edited.</p>
                    )}

                    {error && <p className="text-sm text-red-700">{error}</p>}
                </div>

                <div className="flex justify-end gap-3 px-6 py-4 border-t border-line">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={working}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-ink hover:bg-subtle transition-colors cursor-pointer disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={working}
                        className="px-4 py-2 rounded-lg text-sm font-semibold bg-brand text-on-brand hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                    >
                        {working ? 'Saving…' : editing ? 'Save changes' : 'Post review'}
                    </button>
                </div>
            </form>
        </div>
    )
}