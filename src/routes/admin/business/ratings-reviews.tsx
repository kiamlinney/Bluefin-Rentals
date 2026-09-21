import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Star, X } from 'lucide-react'
import { adminImportReview, adminRemoveReview, getAdminReviews } from '@/lib/db'
import { REVIEW_BODY_MAX, REVIEWER_NAME_MAX, STAR_VALUES, formatAverage, summarizeRatings, validateReviewBody } from '@/lib/reviews'
import { businessDateKey, formatBusinessDate } from '@/lib/dates'
import { carSlug } from '@/lib/slug'
import type { AdminReview } from '@/types.ts'
import { StarInput, Stars } from '@/components/reviews/Stars'

// Every visible review

export const Route = createFileRoute('/admin/business/ratings-reviews')({
    loader: () => getAdminReviews(),
    component: RatingsReviewsPage,
})

const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }

function RatingsReviewsPage() {
    const { reviews, completedTrips, cars } = Route.useLoaderData()
    const [importing, setImporting] = useState(false)

    const summary = summarizeRatings(reviews.map((r) => r.rating))

    return (
        <div className="py-8 md:py-16 px-4 md:px-8">
            <div className="max-w-6xl mx-auto">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-10">
                    <h1 className="text-3xl text-black font-bold">Ratings &amp; reviews</h1>
                    <button
                        onClick={() => setImporting(true)}
                        className="px-4 py-2 rounded-lg border border-line text-sm font-semibold hover:bg-subtle transition-colors cursor-pointer"
                    >
                        Add Turo review
                    </button>
                </div>

                <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                    {/* Ratings */}
                    <section aria-labelledby="ratings-heading">
                        <h2 id="ratings-heading" className="text-2xl font-bold">Ratings</h2>
                        <p className="text-sm text-muted mt-1">Share of reviews at each star rating</p>

                        <div className="mt-6 rounded-2xl border border-line p-6">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold">Overall</h3>
                                <span className="text-lg font-bold tabular-nums" title="Share of 5-star reviews">
                                    {summary.distribution[5].pct}%
                                </span>
                            </div>

                            <dl className="mt-6 space-y-4">
                                {STAR_VALUES.map((star) => {
                                    const { count, pct } = summary.distribution[star]
                                    return (
                                        <div key={star} className="flex items-center gap-4">
                                            <dt className="w-16 shrink-0">{star} {star === 1 ? 'star' : 'stars'}</dt>
                                            <div className="h-2 flex-1 rounded-full bg-subtle overflow-hidden" aria-hidden>
                                                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                                            </div>
                                            <dd className="w-12 shrink-0 text-right tabular-nums" title={`${count} reviews`}>
                                                {pct}%
                                            </dd>
                                        </div>
                                    )
                                })}
                            </dl>

                            <dl className="mt-8 flex divide-x divide-line">
                                <div className="pr-6">
                                    <dt className="font-semibold">Trips</dt>
                                    <dd className="mt-1 text-lg tabular-nums" title="Completed trips booked on this site">
                                        {completedTrips}
                                    </dd>
                                </div>
                                <div className="px-6">
                                    <dt className="font-semibold">Ratings</dt>
                                    <dd className="mt-1 text-lg tabular-nums">{summary.count}</dd>
                                </div>
                                <div className="pl-6">
                                    <dt className="font-semibold">Average</dt>
                                    <dd className="mt-1 text-lg tabular-nums flex items-center gap-1.5">
                                        {formatAverage(summary.average)}
                                        <Star size={18} className="fill-brand text-brand" aria-hidden />
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    </section>

                    {/* Reviews */}
                    <section aria-labelledby="reviews-heading">
                        <div className="flex flex-wrap items-end justify-between gap-2">
                            <div>
                                <h2 id="reviews-heading" className="text-2xl font-bold">Reviews ({reviews.length})</h2>
                                <p className="text-sm text-muted mt-1">Sorted by most recent</p>
                            </div>
                            <Link to="/reviews" className="text-sm font-semibold underline">View public page</Link>
                        </div>

                        {reviews.length === 0 ? (
                            <p className="mt-8 text-muted">No reviews yet.</p>
                        ) : (
                            <div className="mt-6 divide-y divide-line">
                                {reviews.map((review) => (
                                    <AdminReviewItem key={review.id} review={review} />
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>

            {importing && <ImportReviewDialog cars={cars} onClose={() => setImporting(false)} />}
        </div>
    )
}

function AdminReviewItem({ review }: { review: AdminReview }) {
    const router = useRouter()
    const [confirming, setConfirming] = useState(false)
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const car = review.cars

    const handleDelete = async () => {
        setWorking(true)
        setError(null)
        try {
            await adminRemoveReview({ data: review.id })
            await router.invalidate()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not delete this review.')
            setWorking(false)
            setConfirming(false)
        }
    }

    return (
        <article className="py-6 first:pt-0">
            <div className="flex items-start gap-4">
                <div
                    className="w-12 h-12 shrink-0 rounded-full bg-subtle flex items-center justify-center text-lg font-bold"
                    aria-hidden
                >
                    {review.reviewer_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                    <Stars rating={review.rating} size={20} />
                    <p className="mt-1 text-sm">
                        <span className="font-semibold">{review.reviewer_name}</span>
                        <span className="text-muted"> • {formatBusinessDate(review.created_at, LONG_DATE)}</span>
                    </p>
                </div>
            </div>

            <p className="mt-4 text-sm">
                <Link to="/fleet/$carSlug" params={{ carSlug: carSlug(car) }} className="hover:underline">
                    {car.make} {car.model} {car.year}
                </Link>
                {car.license_plate && <span className="text-muted"> • {car.license_plate}</span>}
            </p>

            <p className="mt-3 whitespace-pre-line break-words">{review.body}</p>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {review.source === 'turo' && <span className="rounded bg-violet-500 text-white font-semibold px-2 py-1">From Turo</span>}
                {review.edited_at && (
                    <span className="rounded bg-subtle px-2 py-1">
                        Edited {formatBusinessDate(review.edited_at, LONG_DATE)}
                    </span>
                )}
                {review.booking_id && (
                    <Link
                        to="/admin/reservation/$bookingId"
                        params={{ bookingId: review.booking_id }}
                        className="rounded bg-subtle px-2 py-1 hover:underline"
                    >
                        View reservation
                    </Link>
                )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-3 text-sm">
                {confirming ? (
                    <>
                        <span className="text-muted">Delete this review? It will disappear from the site.</span>
                        <button
                            onClick={() => setConfirming(false)}
                            disabled={working}
                            className="px-3 py-1.5 rounded-lg font-semibold hover:bg-subtle cursor-pointer disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleDelete}
                            disabled={working}
                            className="px-3 py-1.5 rounded-lg font-semibold bg-red-700 text-white hover:bg-red-800 cursor-pointer disabled:opacity-50"
                        >
                            {working ? 'Deleting…' : 'Delete'}
                        </button>
                    </>
                ) : (
                    <button
                        onClick={() => setConfirming(true)}
                        className="px-3 py-1.5 rounded-lg border border-line font-semibold hover:bg-subtle cursor-pointer"
                    >
                        Delete
                    </button>
                )}
            </div>
            {error && <p className="mt-2 text-right text-sm text-red-700">{error}</p>}
        </article>
    )
}

const inputClass =
    'w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm ' +
    'focus:outline-none focus:border-ink-400 transition-colors'

type ImportCar = { id: number; year: number; make: string; model: string; license_plate: string | null; is_available: boolean | null }

// Carrying reviews over from Turo by hand. They show publicly with a
// "From Turo" tag and their original date.
function ImportReviewDialog({ cars, onClose }: { cars: ImportCar[]; onClose: () => void }) {
    const router = useRouter()
    const [carId, setCarId] = useState(cars[0]?.id ?? 0)
    const [reviewerName, setReviewerName] = useState('')
    const [reviewedOn, setReviewedOn] = useState(() => businessDateKey(new Date()))
    const [rating, setRating] = useState(5)
    const [body, setBody] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const overlayRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        overlayRef.current?.focus()
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape' && !working) onClose()
        }
        document.addEventListener('keydown', handleKey)
        return () => document.removeEventListener('keydown', handleKey)
    }, [onClose, working])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const checked = validateReviewBody(body)
        if (!checked.ok) return setError(checked.error)
        if (!reviewerName.trim()) return setError('Enter the renter’s name.')

        setWorking(true)
        setError(null)
        try {
            await adminImportReview({ data: { carId, reviewerName, reviewedOn, rating, body: checked.body } })
            await router.invalidate()
            onClose()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not save this review.')
            setWorking(false)
        }
    }

    return (
        <div
            ref={overlayRef}
            tabIndex={-1}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
            onClick={(e) => { if (e.target === e.currentTarget && !working) onClose() }}
        >
            <form
                onSubmit={handleSubmit}
                role="dialog"
                aria-modal="true"
                aria-labelledby="import-review-title"
                className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-line">
                    <h2 id="import-review-title" className="text-lg font-bold">Add a Turo review</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={working}
                        aria-label="Close"
                        className="p-1.5 -mr-1.5 rounded-full hover:bg-subtle cursor-pointer"
                    >
                        <X size={20} className="text-muted" />
                    </button>
                </div>

                <div className="px-6 py-5 overflow-y-auto space-y-4">
                    <label className="block">
                        <span className="block text-sm font-semibold mb-1">Car</span>
                        <select value={carId} onChange={(e) => setCarId(Number(e.target.value))} className={inputClass}>
                            {cars.map((car) => (
                                <option key={car.id} value={car.id}>
                                    {car.year} {car.make} {car.model}
                                    {car.license_plate ? ` • ${car.license_plate}` : ''}
                                    {car.is_available ? '' : ' (retired)'}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className="grid grid-cols-2 gap-4">
                        <label className="block">
                            <span className="block text-sm font-semibold mb-1">Renter’s first name</span>
                            <input
                                value={reviewerName}
                                onChange={(e) => setReviewerName(e.target.value)}
                                maxLength={REVIEWER_NAME_MAX}
                                className={inputClass}
                            />
                        </label>
                        <label className="block">
                            <span className="block text-sm font-semibold mb-1">Review date</span>
                            <input
                                type="date"
                                value={reviewedOn}
                                onChange={(e) => setReviewedOn(e.target.value)}
                                className={inputClass}
                            />
                        </label>
                    </div>

                    <div>
                        <span className="block text-sm font-semibold mb-1">Rating</span>
                        <StarInput value={rating} onChange={setRating} />
                    </div>

                    <label className="block">
                        <span className="block text-sm font-semibold mb-1">Review</span>
                        <textarea
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            rows={5}
                            maxLength={REVIEW_BODY_MAX}
                            className={`${inputClass} resize-y`}
                        />
                    </label>

                    {error && <p className="text-sm text-red-700">{error}</p>}
                </div>

                <div className="flex justify-end gap-3 px-6 py-4 border-t border-line">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={working}
                        className="px-4 py-2 rounded-lg text-sm font-semibold hover:bg-subtle cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={working}
                        className="px-4 py-2 rounded-lg text-sm font-semibold bg-neutral-900 text-white hover:bg-neutral-800 cursor-pointer disabled:opacity-50"
                    >
                        {working ? 'Saving…' : 'Add review'}
                    </button>
                </div>
            </form>
        </div>
    )
}