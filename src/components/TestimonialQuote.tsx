import { cn } from '@/lib/utils'
import { formatTestimonialDate, type Testimonial } from '@/lib/testimonials'

/** One testimonial: the guest's words, then "— Name · Month Year". */
export function TestimonialQuote({
    testimonial,
    className,
    quoteClassName,
}: {
    testimonial: Testimonial
    className?: string
    quoteClassName?: string
}) {
    return (
        <figure className={className}>
            <blockquote>
                <p className={cn('leading-snug font-[350]', quoteClassName)}>
                    “{testimonial.quote}”
                </p>
            </blockquote>
            <figcaption className="mt-4 flex items-center gap-3 text-muted">
                <span aria-hidden className="h-0.5 w-6 bg-pine-500" />
                <span>
                    <span className="font-semibold text-ink">{testimonial.name}</span>
                    {' · '}
                    {formatTestimonialDate(testimonial.date)}
                </span>
            </figcaption>
        </figure>
    )
}
