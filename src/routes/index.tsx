import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowDown, MoveUpRight } from "lucide-react"
import { SearchBar } from '@/components/SearchBar'
import { useEffect, useRef, useState } from "react";
import CarCard from "@/components/CarCard.tsx";
import { getFeaturedCars } from "@/lib/db.ts";
import { absoluteUrl } from '@/lib/site'
import { businessJsonLd, seoMeta } from '@/lib/business'
import { cn } from '@/lib/utils'

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
    loader: async () => {
        const featuredCars = await getFeaturedCars()
        return { featuredCars }
    },
    component: Home,
})

// The "How it works" link. scrollIntoView rather than a bare #hash jump so it
// can animate, and so the sheet's scroll-mt-14 keeps it clear of the navbar.
function scrollToContent(event: React.MouseEvent<HTMLAnchorElement>) {
    const target = document.getElementById('home-content')
    if (!target) return
    event.preventDefault()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
}

function Home() {
    const { featuredCars } = Route.useLoaderData()
    const [showBar, setShowBar] = useState(false)
    const videoRef = useRef<HTMLVideoElement>(null)

    // CSS can't pause a video, so prefers-reduced-motion has to be read here.
    // The poster stays painted underneath, so pausing leaves a still image
    // rather than a hole.
    useEffect(() => {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)')
        const apply = () => {
            const video = videoRef.current
            if (!video) return
            if (query.matches) video.pause()
            else void video.play().catch(() => {})
        }
        apply()
        query.addEventListener('change', apply)
        return () => query.removeEventListener('change', apply)
    }, [])

    // Fades the hero copy out as the sheet rises toward it, so the sheet's edge
    // never slices through a half-visible headline. Opacity is written straight
    // to the DOM rather than through state: this runs every scroll frame, and a
    // React re-render per frame would be the very jank the sticky layout avoids.
    const copyRef = useRef<HTMLDivElement>(null)
    const sheetRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        let frame = 0
        const update = () => {
            frame = 0
            const copy = copyRef.current
            const sheet = sheetRef.current
            if (!copy || !sheet) return
            const box = copy.getBoundingClientRect()
            const sheetTop = sheet.getBoundingClientRect().top
            // Fully visible until the sheet reaches the bottom of the copy block
            // (its pb-24 is the lead-in), fully gone by the time the sheet is 40%
            // of the way up it — before the edge reaches the headline.
            const start = box.bottom
            const end = box.top + box.height * 0.4
            const progress = Math.min(Math.max((start - sheetTop) / (start - end), 0), 1)
            copy.style.opacity = String(1 - progress)
        }
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(update)
        }
        // Run once on mount too: a reload restores the scroll position mid-page.
        update()
        window.addEventListener('scroll', onScroll, { passive: true })
        window.addEventListener('resize', onScroll)
        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener('scroll', onScroll)
            window.removeEventListener('resize', onScroll)
        }
    }, [])

    return (
        <div>
            {/* -mt-14 pulls the hero up behind the sticky navbar so the video runs
                edge to edge. sticky keeps it pinned while the content sheet below
                scrolls up over it. No overflow-hidden: the video can't overflow
                (object-cover), and clipping here would cut off the SearchBar's
                date popover. */}
            <section className="sticky top-0 h-svh -mt-14">
                <video
                    ref={videoRef}
                    autoPlay
                    muted
                    loop
                    playsInline
                    poster="/background-poster.webp"
                    /* scaleX(-1) mirrors the footage; translateZ(0) puts the video on
                       its own compositing layer so scrolling doesn't re-rasterize it.
                       Both must live in one transform — a second `transform`
                       declaration would drop the first.  [transform:scaleX(-1)_translateZ(0)]*/
                    className="absolute inset-0 h-full w-full object-cover object-center"
                >
                    <source
                        src="https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/background-videos/background-v2-mobile.mp4"
                        type="video/mp4"
                        media="(max-width: 640px)"
                    />
                    <source
                        src="https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/background-videos/background-v2.mp4"
                        type="video/mp4"
                    />
                    Your browser does not support the video tag.
                </video>

                {/* Scrim, purely for copy legibility. Wide screens get a
                    left-weighted gradient: the copy sits on the left, so the
                    right side can stay bright. On a phone the copy spans the
                    full width and would run onto the transparent end, so it
                    gets an even tint instead. */}
                <div className="absolute inset-0 bg-black/40 sm:bg-transparent sm:bg-gradient-to-r sm:from-black/60 sm:via-black/25 sm:to-transparent"></div>

                {/* Phones: the copy sits near the top (pt-20 clears the navbar)
                    instead of being vertically centred, so the stacked search
                    bar stays well clear of the bottom of the screen. The date
                    picker itself opens as a bottom sheet there, so it no longer
                    depends on room below the bar. From sm up the bar is a
                    single row, so centring works fine. */}
                <div className="relative z-10 h-full flex items-start pt-20 sm:items-center sm:pt-0">
                    {/* px-6 on phones lines the headline up with the logo and
                        with every section below, which all use px-6.
                        Used to be pb-24.*/}
                    {/* text-center on phones: a short, stacked hero reads as a
                        single centred block on a narrow screen. From sm up it
                        goes back to left-aligned, matching the left-weighted
                        scrim. */}
                    <div ref={copyRef} className="w-full px-6 pt-8 sm:pt-0 sm:px-12 lg:px-20 pb-42 text-center sm:text-left will-change-[opacity]">
                        {/* One h1 per page; the line break is presentation, not structure. */}
                        {/* Preflight resets h1 to font-size:inherit, so the base size
                            has to be stated or mobile renders this at body size. */}
                        <h1 className="text-white text-4xl sm:text-4xl md:text-5xl font-semibold mb-4 tracking-tight">
                            <span className="block mb-4">Less Hassle,</span>
                            <span className="block">More Driving</span>
                        </h1>
                        <p className="text-base md:text-xl text-white">
                            Rent from trusted locals in <span className="whitespace-nowrap">Minneapolis-St.Paul</span>
                        </p>

                        
                        <div
                            className={cn(
                                'mt-6 sm:mt-8 mx-auto sm:mx-0 flex flex-col items-center gap-4 sm:flex-row sm:flex-wrap sm:gap-x-8',
                                !showBar && 'max-w-[240px] sm:max-w-none',
                            )}
                        >
                        <div
                            className={`w-full transition-[max-width] duration-500 ease-out ${
                                showBar ? 'max-w-5xl' : 'max-w-[240px]'
                            }`}
                        >
                            {!showBar ? (
                                <button
                                    onClick={() => setShowBar(true)}
                                    className="h-14 sm:h-16 w-full rounded-full bg-white shadow-lg border border-line text-ink font-semibold flex items-center justify-center gap-2 hover:bg-cream-100 transition-colors cursor-pointer"
                                >
                                    Book Now <MoveUpRight size={14}/>
                                </button>
                            ) : (
                                <SearchBar />
                            )}
                        </div>

                        {/* The scroll signal: a way down that's worth taking, the arrow
                            itself falling and fading to say "there's more".
                            Hidden once the search bar opens — it would wrap under the
                            expanding bar mid-animation, and by then the visitor is
                            already booking. */}
                        {!showBar && (
                            <a
                                href="#home-content"
                                onClick={scrollToContent}
                                className="group inline-flex items-center gap-3 text-lg font-medium text-white"
                            >
                                <span className="underline underline-offset-[6px] decoration-white/50 transition-colors group-hover:decoration-white">
                                    Learn more
                                </span>
                                <ArrowDown
                                    size={18}
                                    className="motion-safe:animate-[scroll-cue_2.2s_cubic-bezier(0.65,0,0.35,1)_infinite]"
                                />
                            </a>
                        )}
                        </div>
                    </div>
                </div>
            </section>

            {/* The sheet that rises over the pinned video. Its solid background is
                what keeps the text readable: the video is hidden behind it, never
                showing through. The shadow above the rounded top edge makes it read
                as a layer sliding over the video rather than the video ending.
                data-nav-solid-from tells the Navbar to switch from its transparent
                over-video style to solid once this reaches the top of the screen. */}
            <div ref={sheetRef} id="home-content" data-nav-solid-from className="relative z-10 scroll-mt-14 bg-page shadow-[0_-40px_40px_-10px_rgba(0,0,0,0.45)]">
                <FeaturedCars cars={featuredCars} />
                <LocalContent />
            </div>
        </div>
    )
}

// Chosen and ordered by getFeaturedCars: most open days in the coming week, shown
// cheapest first. Renders nothing if no car has an open day, rather than an
// empty heading.
function FeaturedCars({ cars }: { cars: Awaited<ReturnType<typeof getFeaturedCars>> }) {
    if (cars.length === 0) return null

    return (
        <section className="max-w-5xl mx-auto px-6 pt-16">
            <div className="flex items-baseline justify-between gap-4 mb-6">
                <h2 className="text-2xl md:text-3xl tracking-tight">Available this week</h2>
                <Link to="/fleet" className="text-sm text-muted underline underline-offset-4 hover:text-ink">
                    See all cars
                </Link>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
                {cars.map(car => (
                    <CarCard key={car.id} car={car} />
                ))}
            </div>
        </section>
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
            <div className="space-y-4 text-muted leading-relaxed max-w-3xl">
                <p>
                    BlueFin Rentals is a locally owned car rental company based in Saint Paul,
                    Minnesota. We rent a small, hand-picked fleet of sedans, hybrids, and SUVs to
                    drivers across the Twin Cities — no rental counter, no queue, and never any hidden fees.
                </p>
                <p>
                    Booking takes a few minutes online. Pick your dates, verify your driver's
                    license, and pay. Trips can start as soon as three hours from now, any day
                    between 10:00 AM and 10:30 PM.
                </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 mt-12">
                <div className="rounded-2xl border border-line bg-surface p-6">
                    <h3 className="text-lg font-semibold mb-2">Pick up locally, or we deliver</h3>
                    <p className="text-muted text-sm leading-relaxed">
                        Collect from our Saint Paul home base, MSP airport, the Grand Hotel
                        Minneapolis, or the MSP light rail station at no extra cost. Prefer the car
                        brought to you? We deliver within 10 miles of Saint Paul for a flat $120.
                    </p>
                </div>
                <div className="rounded-2xl border border-line bg-surface p-6">
                    <h3 className="text-lg font-semibold mb-2">Cheaper the longer your trip</h3>
                    <p className="text-muted text-sm leading-relaxed">
                        Discounts apply automatically: 5% off from three days, 10% from a week, 15%
                        from two weeks, and 20% from three. Month-long trips save around 24%.
                    </p>
                </div>
                <div className="rounded-2xl border border-line bg-surface p-6">
                    <h3 className="text-lg font-semibold mb-2">Straightforward pricing</h3>
                    <p className="text-muted text-sm leading-relaxed">
                        The daily rate and any delivery fee are shown before you pay, and the full
                        breakdown detailing each day appears before and at checkout.
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