import { createFileRoute, Link } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { cn } from '@/lib/utils'
import { seoMeta } from '@/lib/business'

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
    return (
        <>
            <section className="bg-subtle">
                <div className="max-w-6xl mx-auto px-6 py-16 md:py-24 grid gap-10 md:grid-cols-2 md:items-center">
                    <div>
                        <h1 className="text-4xl md:text-5xl tracking-tight mb-6">About Us</h1>
                        <div className="space-y-4 text-lg text-muted leading-relaxed max-w-prose">
                            <p>
                                Bluefin Rentals is a small, locally owned car rental company
                                based in Saint Paul. We've rented on Turo for over 3 years,
                                with over 700 trips and a 5.0 star rating.
                            </p>
                            <p>
                                There's no rental counter and no call center. When you book with
                                us, you're dealing with the people who own the car.
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

// The source photo is portrait (3:4) but the box is landscape (4:3), so
// object-cover crops it; object-[center_35%] shifts that crop up from centre
// so the faces sit in frame rather than the vests.
function OwnersPhoto() {
    return (
        <img
            src="/about.jpg"
            alt="Jade and Nick, the owners of Bluefin Rentals."
            width={1200}
            height={1600}
            className="aspect-[4/3] w-full rounded-2xl object-cover object-[center_35%]"
        />
    )
}
