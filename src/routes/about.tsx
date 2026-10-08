import { createFileRoute, Link } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { seoMeta } from '@/lib/business'
import { TESTIMONIALS } from '@/lib/testimonials'
import { TestimonialQuote } from '@/components/TestimonialQuote'

export const Route = createFileRoute('/about')({
    head: () => ({
        meta: seoMeta({
            title: 'About Bluefin Rentals | Locally Owned Car Rental in Saint Paul',
            description:
                'Bluefin Rentals is a locally owned car rental company serving Saint Paul and Minneapolis with a hand-picked fleet and no booking fees.',
            path: '/about',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/about') }],
    }),
    component: About,
})

function About() {
    // The first in the list is the one we lead with; undefined while there are none.
    const featured = TESTIMONIALS[0]

    return (
        <>
            <section className="bg-subtle">
                <div className="max-w-6xl mx-auto px-6 py-16 md:py-24 grid gap-10 md:grid-cols-2 md:items-center">
                    <div>
                        <h1 className="text-4xl md:text-5xl tracking-tight mb-6">How we got here</h1>
                        <div className="space-y-4 text-lg text-muted leading-relaxed max-w-prose">
                            <p>
                                Honestly, we got into this because we were tired of renting cars.
                                You probably know the drill. You wait in line at the counter after
                                a long flight, get upsold on things you don't need, and then the car
                                you booked isn't even there and they hand you whatever's left. A week later
                                there's a charge on your card you don't recognize. And good luck getting
                                someone on the phone about it. We knew there was a better way.
                            </p>
                            <p>
                                In 2018, Jed was traveling in California
                                and needed a car last minute. On a whim he tried Turo instead. The host
                                texted him, they figured out pickup, he got the car, and that was it.
                                No line, no counter, no drama. He remembers thinking, "Why isn't every
                                rental like this?" That idea was stuck in his head for a while. Eventually Jed
                                Nick bought their first car and here we are today.
                            </p>
                        </div>
                    </div>

                    <OwnersPhoto />
                </div>
            </section>

            <section className="max-w-6xl mx-auto px-6 py-16 md:py-24 grid gap-10 md:grid-cols-2 md:items-center">
                <div>
                    <h2 className="text-3xl md:text-4xl tracking-tight mb-6">Why book direct</h2>
                    <div className="space-y-4 text-lg text-muted leading-relaxed max-w-prose">
                        <p>
                            You can still find us on Turo, but booking at rentbluefin.com skips
                            the marketplace fees. The price you see is the price you pay.
                            Pick up in Saint Paul, Minneapolis, or at our home base 10 minutes
                            from MSP. Or we'll deliver it to you around the Twin Cities.
                            And if something comes up during your trip, you'll reach Jed or
                            Nick. Not a call center. Not a bot. Us.
                        </p>
                    </div>
                </div>

                <MR2Photo />
            </section>

            {featured && (
                <section className="max-w-6xl mx-auto px-6 pb-16 md:pb-24">
                    <div className="max-w-3xl border-t border-line pt-12">
                        <TestimonialQuote
                            testimonial={featured}
                            quoteClassName="text-2xl md:text-3xl"
                        />
                        <Link
                            to="/testimonials"
                            className="mt-8 inline-block font-semibold text-ink underline underline-offset-4 hover:opacity-70"
                        >
                            Read more from our guests →
                        </Link>
                    </div>
                </section>
            )}


            <section className="max-w-6xl mx-auto px-6 pb-16">
                <div className="rounded-2xl border border-line bg-surface p-8 md:flex md:items-center md:justify-between md:gap-8">
                    <div>
                        <h2 className="text-2xl font-semibold mb-2">All set?</h2>
                        <p className="text-muted">
                            Browse the fleet and pick your dates, or send us a question first.
                        </p>
                    </div>
                    {/* shrink-0 stops the buttons from being squeezed onto two
                        lines when the text next to them is long. */}
                    <div className="mt-6 md:mt-0 flex flex-wrap shrink-0">
                        <Link to="/fleet" className="secondary-button inline-block font-semibold">
                            Browse the fleet
                        </Link>
                        <Link to="/contact" className="primary-button inline-block font-semibold">
                            Contact us
                        </Link>
                    </div>
                </div>
            </section>
        </>
    )
}

// The source photo is portrait (3:4) but the box is landscape (4:3), so
// object-cover crops it; object-[center_35%] shifts that crop up from centre
// so the faces sit in frame rather than the vests.
function OwnersPhoto() {
    return (
        <img
            src="/owners.jpg"
            alt="Jade and Nick, the owners of Bluefin Rentals."
            width={1200}
            height={1600}
            className="aspect-[4/4] w-full rounded-md object-cover object-[center_35%]"
        />
    )
}

function MR2Photo() {
    return (
        <img
            src="/mr2.jpg"
            alt="Our MR2"
            width={1200}
            height={1600}
            className="aspect-[16/9] w-full rounded-md object-cover object-[center_35%] md:order-first"
        />
    )
}
