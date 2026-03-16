import {createFileRoute} from '@tanstack/react-router'
import {getCarById} from "@/lib/db.ts";

export const Route = createFileRoute('/fleet/$carId')({
    loader: async ({ params }) => {
        const car = await getCarById({ data: params.carId })
        return { car }
    },

    // Meta tag generation to optimize SEO
    head: ({ loaderData }) => ({
        meta: [
            {
                title: `${loaderData?.car.make} ${loaderData?.car.model} (${loaderData?.car.year}) | Bluefin Rentals`
            },
            {
                name: 'description',
                content: `Rent this ${loaderData?.car.year} ${loaderData?.car.make} ${loaderData?.car.model} in Saint Paul. Featuring ${loaderData?.car.num_seats} seats, ${loaderData?.car.mpg} MPG.`
            },
            { property: 'og:title', content: `${loaderData?.car.make} ${loaderData?.car.model} Rental - Bluefin` },
            { property: 'og:type', content: 'website' },
            {
                property: 'og:image',
                content: `https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${loaderData?.car.id}/$main.PNG`
            },
        ],
    }),
    component: CarDetails,
})

function CarDetails() {
    const { car } = Route.useLoaderData()
    const { carId } = Route.useParams()

    const projectID = "fmueikfpthimanfrituz"
    const getImageUrl = (fileName: string) =>
        `https://${projectID}.supabase.co/storage/v1/object/public/car%20gallery/car_${carId}/${fileName}`

    return (
        <div className="container mx-auto p-8">
            <h1 className="text-4xl font-bold">{car.make} {car.model} {car.year}</h1>
            <p className="text-gray-600 text-xl">{car.num_seats} Seats, {car.fuel_type}, {car.mpg} MPG, {car.transmission} transmission</p>
            {/* Rest of UI for single car: */}
            <div className="mt-8 grid grid-cols-1 lg:grid-cols-4 gap-2 rounded-xl overflow-hidden">

                {/* Main picture */}
                <div className="lg:col-span-2 lg:row-span-2 relative h-[400px]">
                    <img src={getImageUrl('main.PNG')} className="w-full h-full object-cover" alt="Car front" />
                </div>

                {/* 2. Top Left Image */}
                <div className="hidden lg:block h-[196px]">
                    <img src={getImageUrl('top_left.PNG')} className="w-full h-full object-cover" />
                </div>

                {/* 3. Top Right Image */}
                <div className="hidden lg:block h-[196px]">
                    <img src={getImageUrl('top_right.PNG')} className="w-full h-full object-cover" />
                </div>

                {/* 4. Bottom Left Image */}
                <div className="hidden lg:block h-[196px]">
                    <img src={getImageUrl('bottom_left.PNG')} className="w-full h-full object-cover" />
                </div>

                {/* 5. Bottom Right Image */}
                <div className="hidden lg:block h-[196px] relative group cursor-pointer">
                    <img src={getImageUrl('bottom_right.PNG')} className="w-full h-full object-cover brightness-75" />
                    {/* The Expand Button - positioned at the bottom right */}
                    <button className="absolute bottom-4 right-4 text-white bg-gray-600 px-4 py-2 rounded-lg shadow-md hover:scale-105 transition-transform">
                        View all photos
                    </button>
                </div>
            </div>
        </div>
    )
}
