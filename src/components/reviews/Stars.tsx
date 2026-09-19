import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils.ts'
import { STAR_VALUES } from '@/lib/reviews.ts'

const ASCENDING = [...STAR_VALUES].reverse()

/** Read-only row of five stars. */
export function Stars({ rating, size = 16, className }: { rating: number; size?: number; className?: string }) {
    return (
        <div className={cn('flex items-center gap-0.5', className)} role="img" aria-label={`${rating} out of 5 stars`}>
            {ASCENDING.map((n) => (
                <Star
                    key={n}
                    size={size}
                    className={n <= Math.round(rating) ? 'fill-brand text-brand' : 'fill-line text-line'}
                    aria-hidden
                />
            ))}
        </div>
    )
}

const LABELS: Record<number, string> = {
    1: 'Terrible',
    2: 'Poor',
    3: 'Okay',
    4: 'Good',
    5: 'Excellent',
}

/**
 * Clickable 1–5 picker. A radio group underneath, so arrow keys and screen
 * readers work the way they do for any other single choice.
 */
export function StarInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
    const [hover, setHover] = useState<number | null>(null)
    const shown = hover ?? value

    return (
        <div className="flex items-center gap-3">
            <div
                role="radiogroup"
                aria-label="Rating"
                className="flex items-center gap-1"
                onMouseLeave={() => setHover(null)}
            >
                {ASCENDING.map((n) => (
                    <label key={n} className="cursor-pointer" onMouseEnter={() => setHover(n)}>
                        <input
                            type="radio"
                            name="rating"
                            value={n}
                            checked={value === n}
                            onChange={() => onChange(n)}
                            className="peer sr-only"
                            aria-label={`${n} star${n === 1 ? '' : 's'}`}
                        />
                        <Star
                            size={30}
                            className={cn(
                                'transition-colors rounded-sm peer-focus-visible:outline-2 peer-focus-visible:outline-brand',
                                n <= shown ? 'fill-brand text-brand' : 'fill-transparent text-ink-400',
                            )}
                            aria-hidden
                        />
                    </label>
                ))}
            </div>
            <span className="text-sm text-muted min-w-[5rem]">{shown ? LABELS[shown] : ''}</span>
        </div>
    )
}