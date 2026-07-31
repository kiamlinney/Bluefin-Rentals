import { createFileRoute, useNavigate } from '@tanstack/react-router'
import CarCard from "@/components/CarCard.tsx";
import { getCars, getAvailableCars } from "@/lib/db.ts";
import { SearchBar } from "@/components/SearchBar";
import { Car } from "@/types.ts";

type FleetSearch = {
    location?: 'MSP' | 'stpaul-mpls'
    start?: string
    end?: string
}

export const Route = createFileRoute('/fleet/')({
    validateSearch: (search: any): FleetSearch => {
        return {
            location: search?.location === 'stpaul-mpls' ? 'stpaul-mpls' : 'MSP',
            start: typeof search?.start === 'string' ? search.start : undefined,
            end: typeof search?.end === 'string' ? search.end : undefined,
        }
    },
    loader: async ({ deps }) => {
        const { start, end } = (deps.search ?? {}) as FleetSearch

        if (!start || !end) {
            const cars = await getCars()
            return { cars }
        }

        const cars = await getAvailableCars({ start, end})
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
                        start: search.start ? new Date(search.start) : undefined,
                        end: search.end ? new Date(search.end) : undefined,
                    }}
                />
                <button
                    onClick={clearAll}
                    className="h-10 px-4 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 cursor-pointer"
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
                        <CarCard key={car.id} car={car} />
                    ))}
                </div>
            )}


        </div>
    )
}