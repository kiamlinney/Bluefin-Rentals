// Ratings & reviews: the rules and arithmetic every surface shares.
//
// Pure and isomorphic, like pricing.ts. The review form validates against the
// same limits the server re-checks, and the public page, the car page and the
// admin page all summarise through summarizeRatings — three hand-rolled
// averages would eventually round differently and disagree on the same data.

export const REVIEW_BODY_MAX = 2000
export const REVIEWER_NAME_MAX = 60

export const STAR_VALUES = [5, 4, 3, 2, 1] as const
export type StarValue = (typeof STAR_VALUES)[number]

export type RatingSummary = {
    count: number
    // null when there are no ratings, so callers can't render "0.0 ★" by accident.
    average: number | null
    distribution: Record<StarValue, { count: number; pct: number }>
}

export function summarizeRatings(ratings: number[]): RatingSummary {
    const distribution = Object.fromEntries(
        STAR_VALUES.map((star) => [star, { count: 0, pct: 0 }]),
    ) as RatingSummary['distribution']

    let total = 0
    for (const rating of ratings) {
        const star = Math.round(rating) as StarValue
        if (!distribution[star]) continue
        distribution[star].count += 1
        total += star
    }

    const count = STAR_VALUES.reduce((n, star) => n + distribution[star].count, 0)
    for (const star of STAR_VALUES) {
        distribution[star].pct = count ? Math.round((distribution[star].count / count) * 100) : 0
    }

    return { count, average: count ? total / count : null, distribution }
}

// "4.9" — one decimal, the way Turo shows it.
export function formatAverage(average: number | null): string {
    return average === null ? '–' : average.toFixed(1)
}

// Only the first name is ever shown publicly ("Michael • June 10, 2026").
export function firstName(fullName: string | null | undefined): string {
    const first = fullName?.trim().split(/\s+/)[0]
    return first ? first.slice(0, REVIEWER_NAME_MAX) : 'Guest'
}

export function isValidRating(value: unknown): value is StarValue {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
}

// Returns the cleaned body, or an error message for the form to show.
export function validateReviewBody(body: string): { ok: true; body: string } | { ok: false; error: string } {
    const trimmed = body.trim()
    if (!trimmed) return { ok: false, error: 'Write a few words about your trip.' }
    if (trimmed.length > REVIEW_BODY_MAX) {
        return { ok: false, error: `Reviews are limited to ${REVIEW_BODY_MAX.toLocaleString()} characters.` }
    }
    return { ok: true, body: trimmed }
}