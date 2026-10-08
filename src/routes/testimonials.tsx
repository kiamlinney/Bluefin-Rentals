import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { seoMeta } from '@/lib/business'
import { HAS_TESTIMONIALS, TESTIMONIALS } from '@/lib/testimonials'
import { TestimonialQuote } from '@/components/TestimonialQuote'

export const Route = createFileRoute('/testimonials')({
    // Never served blank: until the first testimonial is added, this page
    // doesn't exist.
    beforeLoad: () => {
        if (!HAS_TESTIMONIALS) throw notFound()
    },
    head: () => ({
        meta: seoMeta({
            title: 'Testimonials | Bluefin Rentals',
            description:
                'What our regular guests say about renting with Bluefin Rentals in Saint Paul and Minneapolis.',
            path: '/testimonials',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/testimonials') }],
    }),
    component: TestimonialsPage,
})

function TestimonialsPage() {
    return (
        <div className="max-w-6xl mx-auto px-6 py-12 md:py-16">
            <h1 className="text-4xl md:text-5xl tracking-tight">Testimonials</h1>
            <p className="mt-3 text-lg text-muted max-w-prose">
                A few of the guests who've rented with us again and again, in their own words.
            </p>

            <div className="mt-10 max-w-3xl">
                {TESTIMONIALS.map((testimonial) => (
                    <TestimonialQuote
                        key={testimonial.name + testimonial.date}
                        testimonial={testimonial}
                        className="border-t border-line py-10 last:border-b"
                        quoteClassName="text-xl md:text-2xl"
                    />
                ))}
            </div>

            <section className="mt-16">
                <div className="rounded-2xl border border-line bg-surface p-8 md:flex md:items-center md:justify-between md:gap-8">
                    <div>
                        <h2 className="text-2xl font-semibold mb-2">Ready for your own trip?</h2>
                        <p className="text-muted">
                            Browse the fleet and pick your dates, or read every guest review.
                        </p>
                    </div>
                    <div className="mt-6 md:mt-0 flex flex-wrap shrink-0">
                        <Link to="/fleet" className="secondary-button inline-block font-semibold">
                            Browse the fleet
                        </Link>
                        <Link to="/reviews" className="primary-button inline-block font-semibold">
                            All reviews
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    )
}
