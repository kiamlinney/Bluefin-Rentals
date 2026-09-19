import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { deleteMyReview } from '@/lib/db.ts'
import { formatBusinessDate } from '@/lib/dates.ts'
import { carSlug } from '@/lib/slug.ts'
import type { PublicReview } from '@/types.ts'
import { Stars } from './Stars.tsx'
import { ReviewDialog } from './ReviewDialog.tsx'

const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }
const FIRST_PAGE = 5
const PAGE = 10

/** One review, Turo-style: stars, text, then "Name • Date". */
export function ReviewItem({ review, showCar = false }: { review: PublicReview; showCar?: boolean }) {
    const router = useRouter()
    const [editing, setEditing] = useState(false)
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleDelete = async () => {
        setWorking(true)
        setError(null)
        try {
            await deleteMyReview({ data: review.id })
            await router.invalidate()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not delete your review.')
            setWorking(false)
            setConfirmingDelete(false)
        }
    }

    const car = review.cars

    return (
        <article className="py-5 first:pt-0">
            <Stars rating={review.rating} />

            {showCar && (
                <Link
                    to="/fleet/$carSlug"
                    params={{ carSlug: carSlug(car) }}
                    className="inline-block mt-2 text-sm font-semibold text-ink hover:underline"
                >
                    {car.year} {car.make} {car.model}
                </Link>
            )}

            <p className="mt-2 text-ink whitespace-pre-line break-words">{review.body}</p>

            <p className="mt-2 text-sm text-muted flex flex-wrap items-center gap-x-1.5">
                <span>{review.reviewer_name}</span>
                <span aria-hidden>•</span>
                <time dateTime={review.created_at}>{formatBusinessDate(review.created_at, LONG_DATE)}</time>
                {review.edited_at && (
                    <span title={`Edited ${formatBusinessDate(review.edited_at, LONG_DATE)}`}>· Edited</span>
                )}
                {review.source === 'turo' && (
                    <span className="ml-1 rounded-full bg-violet-500 font-semibold text-white px-2 py-0.5 text-xs">From Turo</span>
                )}
            </p>

            {review.is_mine && (
                <div className="mt-2 flex items-center gap-4 text-sm">
                    {confirmingDelete ? (
                        <>
                            <span className="text-muted">Delete your review?</span>
                            <button
                                onClick={handleDelete}
                                disabled={working}
                                className="font-semibold text-red-700 hover:underline cursor-pointer disabled:opacity-50"
                            >
                                {working ? 'Deleting…' : 'Delete'}
                            </button>
                            <button
                                onClick={() => setConfirmingDelete(false)}
                                disabled={working}
                                className="font-semibold text-muted hover:text-ink cursor-pointer"
                            >
                                Keep it
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => setEditing(true)}
                                className="font-semibold text-ink hover:underline cursor-pointer"
                            >
                                Edit
                            </button>
                            <button
                                onClick={() => setConfirmingDelete(true)}
                                className="font-semibold text-muted hover:text-ink cursor-pointer"
                            >
                                Delete
                            </button>
                        </>
                    )}
                </div>
            )}
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

            {editing && (
                <ReviewDialog
                    mode="edit"
                    review={review}
                    onClose={() => setEditing(false)}
                    onSaved={async () => {
                        await router.invalidate()
                        setEditing(false)
                    }}
                />
            )}
        </article>
    )
}

/** Reviews, newest first, five at a time then ten more per "See more". */
export function ReviewList({
    reviews,
    showCar = false,
    emptyMessage = 'No reviews yet.',
}: {
    reviews: PublicReview[]
    showCar?: boolean
    emptyMessage?: string
}) {
    const [visible, setVisible] = useState(FIRST_PAGE)

    if (reviews.length === 0) return <p className="text-muted">{emptyMessage}</p>

    return (
        <div>
            <div className="divide-y divide-line">
                {reviews.slice(0, visible).map((review) => (
                    <ReviewItem key={review.id} review={review} showCar={showCar} />
                ))}
            </div>
            {visible < reviews.length && (
                <button
                    onClick={() => setVisible((v) => v + PAGE)}
                    className="mt-4 px-5 py-2.5 rounded-lg border border-line bg-surface text-sm font-semibold text-ink hover:bg-subtle transition-colors cursor-pointer"
                >
                    See more
                </button>
            )}
        </div>
    )
}