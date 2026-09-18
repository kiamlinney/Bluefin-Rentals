import { createFileRoute, Link } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { cn } from '@/lib/utils'
import { seoMeta } from '@/lib/business'

export const Route = createFileRoute('/about')({
    head: () => ({
        meta: seoMeta({
            title: 'About BlueFin Rentals | Locally Owned Car Rental in Saint Paul',
            description:
                'BlueFin Rentals is a locally owned car rental company serving Saint Paul and Minneapolis with a hand-picked fleet and no booking fees.',
            path: '/about',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/about') }],
    }),
    component: About,
})

function About() {
    return (
        <>
            {/* Two layers, so the background runs edge to edge while the content
                lines up with the rest of the site. The outer <section> is full
                width and carries the colour. The inner div is the same
                max-w-6xl mx-auto px-6 container that the contact page and
                footer use. */}
            <section className="bg-subtle">
                <div className="max-w-6xl mx-auto px-6 py-16 md:py-24 grid gap-10 md:grid-cols-2 md:items-center">
                    <div>
                        <h1 className="text-4xl md:text-5xl tracking-tight mb-6">About Us</h1>
                        {/* max-w-prose caps the line length at about 65 characters*/}
                        <div className="space-y-4 text-lg text-muted leading-relaxed max-w-prose">
                            <p>
                                BlueFin Rentals is a small, locally owned car rental company
                                based in Saint Paul. We've rented with Turo for over 3 years,
                                with over 700 trips and a 5.0 star rating.
                            </p>
                            <p>
                                There's no rental counter and no call center. When you book with
                                us, you're dealing with the people who own the car, clean it and
                                hand you the keys.
                            </p>
                        </div>
                    </div>

                    <PhotoPlaceholder className="bg-surface" />
                </div>
            </section>

            <section className="max-w-6xl mx-auto px-6 py-16 md:py-24 grid gap-10 md:grid-cols-2 md:items-center">
                {/* The text comes first in the source even though the photo shows
                    on the left from md up. Source order is reading order: on a
                    phone the columns stack in this order, and screen readers
                    always follow it. `md:order-first` on the photo moves it left
                    only visually, only on wider screens. */}
                <div>
                    <h2 className="text-3xl md:text-4xl tracking-tight mb-6">Why book direct</h2>
                    <div className="space-y-4 text-lg text-muted leading-relaxed max-w-prose">
                        <p>
                            Rental marketplaces add their own fees to every trip. Booking with
                            us directly means none of that gets added to your price. You see the
                            daily rate, any delivery fee and the full breakdown before you pay.
                            That means complete transparency.
                        </p>
                        <p>
                            Pick your car up in Saint Paul or a few designated locations,
                            or have us bring it to you.
                            Book online in a few minutes, and if anything comes up during
                            your trip, you'll hear back from us directly.
                        </p>
                    </div>
                </div>

                <PhotoPlaceholder className="bg-subtle md:order-first" />
            </section>
            
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

// Stands in for a photo until real ones exist. aspect-[4/3] keeps the box's
// shape at any column width, instead of a fixed height that looks squashed on
// one screen and stretched on another. To swap in a photo, replace the div with:
//
//   <img src="…" alt="Describe the photo" className="aspect-[4/3] w-full rounded-2xl object-cover" />
//
// object-cover crops the photo to fill the box rather than distorting it.
// aria-hidden because an empty box means nothing to a screen reader.
function PhotoPlaceholder({ className }: { className?: string }) {
    return <div aria-hidden="true" className={cn('aspect-[4/3] w-full rounded-2xl border border-line', className)} />
}
