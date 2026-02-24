import {createFileRoute } from '@tanstack/react-router'
import CarCard from "../../components/CarCard.tsx";
import {getCars} from "../../lib/db.ts";

export const Route = createFileRoute('/fleet/')({
    loader: async () => {
        const cars = await getCars()
        return { cars }
    },
    component: Fleet,
})

function Fleet() {
    const { cars } = Route.useLoaderData()

    return (
        <div className="max-w-7xl mx-auto px-4 py-8">
            {/* Header Section */}
            <div className="mb-8">
                <h1 className="text-5xl font-extrabold text-gray-900 mb-4">
                    Our Fleet ({cars.length})
                </h1>

                {/* Filter Buttons */}
                <div className="flex gap-3">
                    <button className="border border-gray-300 px-4 py-2 rounded-lg font-medium flex items-center gap-2 hover:bg-gray-50">
                        Start date - End date
                    </button>
                    <button className="border border-gray-300 px-4 py-2 rounded-lg font-medium hover:bg-gray-50">
                        Airport pickup
                    </button>
                </div>
            </div>

            {/* The Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                {cars.map((car) => (
                    <CarCard key={car.id} car={car} />
                ))}
            </div>
        </div>
    )
}