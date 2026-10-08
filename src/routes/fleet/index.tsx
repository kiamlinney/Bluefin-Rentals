import { createFileRoute, useNavigate } from '@tanstack/react-router'
import CarCard from "@/components/CarCard.tsx";
import { getCars, getAvailableCars } from "@/lib/db.ts";
import { SearchBar } from "@/components/SearchBar";
import { Car } from "@/types.ts";
import { absoluteUrl } from '@/lib/site'
import { seoMeta } from '@/lib/business'

type FleetSearch = {
    start?: string
    end?: string
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

// Only bare 'YYYY-MM-DD' keys get through; the server's availability check works
// in date keys. A stale bookmark carrying the old full-ISO format degrades to
// "show every car" instead of failing the loader.
const asDateKey = (v: unknown): string | undefined =>
    typeof v === 'string' && DATE_KEY.test(v) ? v : undefined

export const Route = createFileRoute('/fleet/')({
    head: () => ({
        meta: seoMeta({
            title: 'Our Fleet | Cars for Rent in Saint Paul & Minneapolis',
            description:
                'Browse every car available from Bluefin Rentals in the Twin Cities — sedans, hybrids, and SUVs with daily pricing and instant online booking.',
            path: '/fleet',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/fleet') }],
    }),
    validateSearch: (search: Record<string, unknown>): FleetSearch => {
        return {
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

        // Date keys, both inclusive. The server judges them with the car page
        // calendar's own rules (dateRangeIsBookable), so /fleet can't list a
        // car the car page then refuses for these dates.
        const cars = await getAvailableCars({ data: { start, end } })
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
            <div className="flex items-center gap-3 flex-wrap">
                <SearchBar
                    className="max-w-[880px]"
                    initial={{
                        start: search.start,
                        end: search.end,
                    }}
                />
                <button
                    onClick={clearAll}
                    className="h-10 px-4 rounded-lg border border-line bg-surface text-sm hover:bg-subtle cursor-pointer"
                >
                    Clear
                </button>
            </div>

            <h1 className="text-3xl sm:text-5xl mt-6 sm:mt-8 mb-4">Our Fleet ({cars.length})</h1>

            {hasDates && cars.length === 0 ? (
                <div className="rounded-xl border border-line bg-surface p-6">
                    <div className="text-lg font-semibold mb-1">No cars available for your dates</div>
                    <div className="text-sm text-muted">
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