import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { getReviewableTrips, getReviews } from '@/lib/db'
import { getUser } from '@/lib/auth'
import { summarizeRatings } from '@/lib/reviews'
import { absoluteUrl } from '@/lib/site'
import { seoMeta } from '@/lib/business'
import { RatingSummary } from '@/components/reviews/RatingSummary'
import { ReviewList } from '@/components/reviews/ReviewList'
import { ReviewDialog } from '@/components/reviews/ReviewDialog'

// Every review across the fleet. Each car's own reviews also appear on its
// /fleet page; this is the one place they're all together.
export const Route = createFileRoute('/reviews')({
    loader: async () => {
        const [reviews, reviewableTrips, user] = await Promise.all([
            getReviews({ data: {} }),
            getReviewableTrips(),
            getUser().catch(() => null),
        ])
        return { reviews, reviewableTrips, loggedIn: Boolean(user) }
    },
    head: () => ({
        meta: seoMeta({
            title: 'Ratings & Reviews | Bluefin Rentals',
            description:
                'Read reviews from guests who rented with Bluefin Rentals in Saint Paul and Minneapolis.',
            path: '/reviews',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/reviews') }],
    }),
    component: ReviewsPage,
})

function ReviewsPage() {
    const { reviews, reviewableTrips, loggedIn } = Route.useLoaderData()
    const router = useRouter()
    const [writing, setWriting] = useState(false)

    const summary = summarizeRatings(reviews.map((r) => r.rating))

    return (
        <div className="max-w-6xl mx-auto px-6 py-12 md:py-16">
            <h1 className="text-4xl md:text-5xl tracking-tight">Ratings &amp; reviews</h1>
            <p className="mt-3 text-lg text-muted max-w-prose">
                Every review here comes from a guest who completed a trip with us.
            </p>
            <p className="mt-3 text-lg text-muted max-w-prose">
                Includes some reviews from Turo.
            </p>


            <div className="mt-10 grid gap-10 lg:grid-cols-[360px_1fr] lg:gap-16">
                <aside className="lg:sticky lg:top-24 lg:self-start">
                    <div className="rounded-2xl border border-line bg-surface p-6">
                        <RatingSummary
                            summary={summary}
                            includesTuro={reviews.some((r) => r.source === 'turo')}
                        />

                        <div className="mt-6 border-t border-line pt-6">
                            {reviewableTrips.length > 0 ? (
                                <button
                                    onClick={() => setWriting(true)}
                                    className="w-full px-4 py-3 rounded-lg bg-brand text-on-brand font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                                >
                                    Write a review
                                </button>
                            ) : loggedIn ? (
                                <p className="text-sm text-muted">
                                    You can post a review once you complete a trip.
                                </p>
                            ) : (
                                <p className="text-sm text-muted">
                                    Rented with us?{' '}
                                    <Link
                                        to="/login"
                                        search={{ redirect: '/reviews' }}
                                        className="font-semibold text-ink underline"
                                    >
                                        Log in
                                    </Link>{' '}
                                    to review your trip.
                                </p>
                            )}
                        </div>
                    </div>
                </aside>

                <section aria-labelledby="all-reviews">
                    <h2 id="all-reviews" className="text-2xl font-bold mb-6">
                        Reviews ({reviews.length})
                    </h2>
                    <ReviewList reviews={reviews} showCar emptyMessage="No reviews yet — check back soon." />
                </section>
            </div>

            {writing && (
                <ReviewDialog
                    mode="create"
                    trips={reviewableTrips}
                    onClose={() => setWriting(false)}
                    onSaved={async () => {
                        await router.invalidate()
                        setWriting(false)
                    }}
                />
            )}
        </div>
    )
}