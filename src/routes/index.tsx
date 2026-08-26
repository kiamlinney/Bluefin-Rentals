import { createFileRoute, Link } from '@tanstack/react-router'
import { MoveUpRight } from "lucide-react"
import { SearchBar } from '@/components/SearchBar'
import { useState } from "react";
import { absoluteUrl } from '@/lib/site'
import { businessJsonLd, seoMeta } from '@/lib/business'

export const Route = createFileRoute('/')({
    head: () => ({
        meta: seoMeta({
            title: 'BlueFin Rentals | Car Rental in Saint Paul & Minneapolis, MN',
            description:
                'Rent a car in Saint Paul and Minneapolis without the middleman. Book online in minutes, pick up locally or get it delivered. No booking fees.',
            path: '/',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/') }],
        scripts: [
            {
                type: 'application/ld+json',
                children: JSON.stringify(businessJsonLd()),
            },
        ],
    }),
    component: Home,
})

function Home() {
    const [showBar, setShowBar] = useState(false)

    return (
        <>
        <main className="relative min-h-screen w-full flex items-center justify-start">
            <div className="absolute inset-0 z-0 overflow-hidden">
                <video
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="absolute w-auto min-w-full min-h-full max-w-none scale-x-[-1]"
                >
                    <source src="/background.mp4" type="video/mp4" />
                    Your browser does not support the video tag.
                </video>
            </div>

            {/* Dark Overlay */}
            <div className="absolute inset-0 z-10 bg-gradient-to-r from-black/40 via-black/20 to-transparent"></div>

            <div className="z-20 pb-50 px-16 md:px-30 ">
                {/* One h1 per page; the line break is presentation, not structure. */}
                <h1 className="text-white md:text-6xl mb-4 tracking-tight">
                    <span className="block mb-4">Less Hassle,</span>
                    <span className="block">More Driving</span>
                </h1>
                <p className="md:text-xl">
                    Rent from trusted locals in Minneapolis-St.Paul
                </p>

                <div className="flex flex-col mt-8 gap-4 h-16 justify-center">
                    {!showBar ? (
                        <button
                            onClick={() => setShowBar(true)}
                            className="bg-white secondary-button font-semibold w-fit flex items-center gap-2"
                        >
                            Book Now <MoveUpRight size={14}/>
                        </button>
                    ) : (
                        <SearchBar />
                    )}
                </div>

            </div>
        </main>

            <LocalContent />
        </>
    )
}

// The homepage is the page that has to rank for "car rental saint paul", and a
// video with one line of copy gives a search engine nothing to read. This sits
// below the fold so the hero is untouched.
function LocalContent() {
    return (
        <section className="max-w-5xl mx-auto px-6 py-20">
            <h2 className="text-3xl md:text-4xl tracking-tight mb-6">
                Car rental in Saint Paul and Minneapolis
            </h2>
            <div className="space-y-4 text-gray-400 leading-relaxed max-w-3xl">
                <p>
                    BlueFin Rentals is a locally owned car rental company based in Saint Paul,
                    Minnesota. We rent a small, hand-picked fleet of sedans, hybrids, and SUVs to
                    drivers across the Twin Cities — no rental counter, no queue, and no upsell at
                    the desk.
                </p>
                <p>
                    Booking takes a few minutes online. Pick your dates, verify your driver's
                    license, and pay — trips can start as soon as three hours from now, any day
                    between 10:00 AM and 10:30 PM.
                </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 mt-12">
                <div className="rounded-2xl border-[0.5px] border-gray-400 p-6">
                    <h3 className="text-lg font-semibold mb-2">Pick up locally, or we deliver</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">
                        Collect from our Saint Paul home base, MSP airport, the Grand Hotel
                        Minneapolis, or the MSP light rail station at no extra cost. Prefer the car
                        brought to you? We deliver within 10 miles of Saint Paul for a flat $140.
                    </p>
                </div>
                <div className="rounded-2xl border-[0.5px] border-gray-400 p-6">
                    <h3 className="text-lg font-semibold mb-2">Cheaper the longer you stay</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">
                        Discounts apply automatically: 5% off from three days, 10% from a week, 15%
                        from two weeks, and 20% from three. Month-long trips save around 24%.
                    </p>
                </div>
                <div className="rounded-2xl border-[0.5px] border-gray-400 p-6">
                    <h3 className="text-lg font-semibold mb-2">Straightforward pricing</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">
                        The daily rate and any delivery fee are shown before you pay, and the full
                        breakdown appears at checkout. Payment is handled by Stripe.
                    </p>
                </div>
            </div>

            <div className="mt-12 flex flex-wrap gap-4">
                <Link to="/fleet" className="secondary-button inline-block font-semibold">
                    Browse the fleet
                </Link>
                <Link to="/faq" className="primary-button inline-block font-semibold">
                    Read the FAQ
                </Link>
            </div>
        </section>
    )
}