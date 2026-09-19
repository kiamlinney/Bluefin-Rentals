import { Star } from 'lucide-react'
import { STAR_VALUES, formatAverage, type RatingSummary as Summary } from '@/lib/reviews.ts'

/** Average, count, and the 5→1 star bars. */
export function RatingSummary({ summary, includesTuro = false }: { summary: Summary; includesTuro?: boolean }) {
    return (
        <div>
            <div className="flex items-center gap-2">
                <span className="text-5xl font-bold text-ink tabular-nums">{formatAverage(summary.average)}</span>
                <Star size={32} className="fill-brand text-brand" aria-hidden />
            </div>
            <p className="text-muted mt-1">
                {summary.count} {summary.count === 1 ? 'rating' : 'ratings'}
            </p>
            {/* Only when the imported reviews are actually in these numbers  */}
            {includesTuro && (
                <p className="text-sm text-muted mt-1">Includes reviews from our Turo trips</p>
            )}

            <dl className="mt-6 space-y-2.5">
                {STAR_VALUES.map((star) => {
                    const { count, pct } = summary.distribution[star]
                    return (
                        <div key={star} className="flex items-center gap-4 text-sm">
                            <dt className="w-14 shrink-0 text-ink">
                                {star} {star === 1 ? 'star' : 'stars'}
                            </dt>
                            <div className="h-2 flex-1 rounded-full bg-subtle overflow-hidden" aria-hidden>
                                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                            </div>
                            <dd className="w-10 shrink-0 text-right text-muted tabular-nums" title={`${count} reviews`}>
                                {pct}%
                            </dd>
                        </div>
                    )
                })}
            </dl>
        </div>
    )
}