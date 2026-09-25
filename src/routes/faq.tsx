import { createFileRoute, Link } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { seoMeta } from '@/lib/business'
import { FAQS, faqJsonLd } from '@/lib/faq'

export const Route = createFileRoute('/faq')({
    head: () => ({
        meta: seoMeta({
            title: 'Rental FAQ | Bluefin Rentals, Saint Paul MN',
            description:
                'Answers on booking, pickup and delivery, hours, discounts, and what you need to rent a car from Bluefin Rentals in the Twin Cities.',
            path: '/faq',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/faq') }],
        scripts: [
            {
                type: 'application/ld+json',
                children: JSON.stringify(faqJsonLd()),
            },
        ],
    }),
    component: Faq,
})

function Faq() {
    return (
        <div className="max-w-3xl mx-auto px-4 py-16">
            <h1 className="text-4xl md:text-5xl tracking-tight mb-4">Frequently asked questions</h1>
            <p className="text-muted mb-12">
                Everything about booking, picking up, and returning a car in the Twin Cities. Still
                stuck?{' '}
                <Link to="/contact" className="underline hover:text-ink">
                    Get in touch
                </Link>
                .
            </p>

            <dl className="divide-y divide-line">
                {FAQS.map(({ question, answer }) => (
                    <div key={question} className="py-6">
                        <dt className="text-lg font-semibold mb-2">{question}</dt>
                        <dd className="text-muted leading-relaxed">{answer}</dd>
                    </div>
                ))}
            </dl>

            <div className="mt-12 rounded-2xl border border-line bg-surface p-6">
                <h2 className="text-xl font-semibold mb-2">Ready to book?</h2>
                <p className="text-muted mb-4">
                    Browse the fleet and pick your dates — most cars can be on the road within a few
                    hours.
                </p>
                <Link to="/fleet" className="secondary-button inline-block font-semibold">
                    See available cars
                </Link>
            </div>
        </div>
    )
}