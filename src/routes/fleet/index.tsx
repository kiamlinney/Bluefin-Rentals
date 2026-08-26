import { createFileRoute, useNavigate } from '@tanstack/react-router'
import CarCard from "@/components/CarCard.tsx";
import { getCars, getAvailableCars } from "@/lib/db.ts";
import { SearchBar } from "@/components/SearchBar";
import { addDays, wallClockToUtcIso } from "@/lib/pricing.ts";
import { Car } from "@/types.ts";
import { absoluteUrl } from '@/lib/site'
import { seoMeta } from '@/lib/business'

type FleetSearch = {
    location?: 'MSP' | 'stpaul-mpls'
    start?: string
    end?: string
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

// Only bare 'YYYY-MM-DD' keys get through. A stale bookmark carrying the old
// full-ISO format would otherwise reach wallClockToUtcIso, which splits on '-',
// gets NaN for the day, and throws — inside a loader, on the server. Rejecting
// here degrades those URLs to "show every car" instead.
const asDateKey = (v: unknown): string | undefined =>
    typeof v === 'string' && DATE_KEY.test(v) ? v : undefined

export const Route = createFileRoute('/fleet/')({
    head: () => ({
        meta: seoMeta({
            title: 'Our Fleet | Cars for Rent in Saint Paul & Minneapolis',
            description:
                'Browse every car available from BlueFin Rentals in the Twin Cities — sedans, hybrids, and SUVs with daily pricing and instant online booking.',
            path: '/fleet',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/fleet') }],
    }),
    validateSearch: (search: Record<string, unknown>): FleetSearch => {
        return {
            location: search?.location === 'stpaul-mpls' ? 'stpaul-mpls' : 'MSP',
            start: asDateKey(search?.start),
            end: asDateKey(search?.end),
        }
    },
    // Without this the loader's `deps` is {} and the date filter never runs, so
    // /fleet has always listed every car regardless of the search bar.
    loaderDeps: ({ search }) => ({ start: search.start, end: search.end }),
    loader: async ({ deps }) => {
        const { start, end } = deps

        if (!start || !end) {
            const cars = await getCars()
            return { cars }
        }

        // Whole-day bounds in the business's timezone, exclusive at the far
        // end: get_available_cars compares half-open ranges, so passing the day
        // *after* the return date is what makes the return day itself count.
        // The calendar blocks a day if a booking touches it at all, and this
        // filter has to agree or /fleet will list cars the car page rejects.
        const cars = await getAvailableCars({
            data: {
                start: wallClockToUtcIso(start, '0:00'),
                end: wallClockToUtcIso(addDays(end, 1), '0:00'),
            },
        })
        return { cars }
    },
    component: Fleet,
})

function Fleet() {
    const { cars } = Route.useLoaderData() as { cars: Car[] }
    const search = Route.useSearch() as FleetSearch
    const navigate = useNavigate()

    const hasDates = !!search.start && !!search.end

    function clearAll() {
        void navigate({ to: '/fleet', search: {} })
    }

    return (
        <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="mt-14 flex items-center gap-3 flex-wrap">
                <SearchBar
                    className="max-w-[880px] rounded-xl"
                    initial={{
                        location: search.location ?? 'MSP',
                        start: search.start,
                        end: search.end,
                    }}
                />
                <button
                    onClick={clearAll}
                    className="h-10 px-4 rounded-lg border border-gray-300 text-sm hover:bg-gray-800 cursor-pointer"
                >
                    Clear
                </button>
            </div>

            <h1 className="text-5xl mt-8 mb-4">Our Fleet ({cars.length})</h1>

            {hasDates && cars.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-white p-6 text-gray-700">
                    <div className="text-lg font-semibold mb-1">No cars available for your dates</div>
                    <div className="text-sm text-gray-600">
                        Try adjusting your pick-up or return dates. You can also click <button onClick={clearAll} className="underline font-medium">Clear</button> to see all cars.
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {cars.map((car) => (
                        <CarCard key={car.id} car={car} search={search} />
                    ))}
                </div>
            )}


        </div>
    )
}