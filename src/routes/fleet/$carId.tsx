import { createFileRoute } from "@tanstack/react-router"
import { getCarById } from "@/lib/db.ts";
import { useState } from "react";
import { Users, Fuel, Gauge, Settings2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/fleet/$carId")({
    loader: async ({ params }) => {
        const car = await getCarById({ data: params.carId })
        return { car }
    },

    // Meta tag generation to optimize SEO
    head: ({ loaderData }) => ({
        meta: [
            {
                title: `${loaderData?.car.make} ${loaderData?.car.model} ${loaderData?.car.year} rental in Saint Paul, MN | Bluefin Rentals`
            },
            {
                name: "description",
                content: `Rent this ${loaderData?.car.year} ${loaderData?.car.make} ${loaderData?.car.model} in Saint Paul. Featuring ${loaderData?.car.num_seats} seats, ${loaderData?.car.mpg} MPG.`
            },
            { property: "og:title", content: `${loaderData?.car.make} ${loaderData?.car.model} Rental - Bluefin` },
            { property: "og:type", content: "website" },
            {
                property: "og:image",
                content: `https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${loaderData?.car.id}/$main.PNG`
            },
        ],
    }),
    component: CarDetails,
})

function CarDetails() {
    const { car } = Route.useLoaderData()
    const { carId } = Route.useParams()
    const [showGallery, setShowGallery] = useState(false);

    const projectID = "fmueikfpthimanfrituz"
    const getImageUrl = (fileName: string) =>
        `https://${projectID}.supabase.co/storage/v1/object/public/car%20gallery/car_${carId}/${fileName}`

    const images = car.gallery_images || [];
    const PREFERRED_ORDER = ["Safety", "Device connectivity", "Convenience", "Additional features"];

    if (showGallery) {
        return (
            <div className="fixed inset-0 z-[100] overflow-y-auto">
                <div className="sticky top-0 backdrop-blur-lg py-4 px-8 flex justify-between items-center border-b-[0.5px] z-50">
                    <h2 className="text-xl font-bold">{car.make} {car.model} {car.year}</h2>
                    <button
                        onClick={() => setShowGallery(false)}
                        className="p-2 hover:bg-gray-900 rounded-full transition-colors cursor-pointer"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 max-w-8xl mx-auto p-4 flex-col gap-8 mt-4">
                    {images.map((img: string, index: number) => (
                        <div key={index} className="w-full rounded-xl overflow-hidden bg-gray-100 shadow-sm">
                            <img
                                src={getImageUrl(img)}
                                className="w-full h-full object-cover aspect-video"
                                alt={`Gallery view ${index + 1}`}
                            />
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="container mx-auto p-4 md:p-8 bg-[#152110]">
            {/* Info & Specs */}
            <div className="flex-1">
                <h1 className="mt-12 text-4xl">{car.make} {car.model} {car.year}</h1>

                {/* Spec Badges */}
                <div className="flex flex-wrap text-black gap-4 mt-6">
                    <div className="flex items-center gap-2 bg-gray-300 px-4 py-2 rounded-lg text-sm">
                        <Users size={18} /> {car.num_seats} seats
                    </div>
                    <div className="flex items-center gap-2 bg-gray-300 px-4 py-2 rounded-lg text-sm">
                        <Fuel size={18} /> {car.fuel_type}
                    </div>
                    <div className="flex items-center gap-2 bg-gray-300 px-4 py-2 rounded-lg text-sm">
                        <Gauge size={18} /> {car.mpg} MPG
                    </div>
                    <div className="flex items-center gap-2 bg-gray-300 px-4 py-2 rounded-lg text-sm">
                        <Settings2 size={18} /> {car.transmission} transmission
                    </div>
                </div>

                <div className="mt-6 grid grid-cols-1 lg:grid-cols-4 gap-2 rounded-lg overflow-hidden group cursor-pointer"
                     onClick={() => setShowGallery(true)}>

                    {/* Main picture */}
                    <div className="lg:col-span-2 lg:row-span-2 relative h-[400px]" >
                        <img src={getImageUrl("main.PNG")} className="w-full h-full object-cover" alt="Car front" />
                    </div>

                    {/* Top Left Image */}
                    <div className="hidden lg:block h-[196px] border border-gray-800">
                        <img src={getImageUrl("top_left.PNG")} className="w-full h-full object-cover" />
                    </div>

                    {/* Top Right Image */}
                    <div className="hidden lg:block h-[196px] border border-gray-800">
                        <img src={getImageUrl("top_right.PNG")} className="w-full h-full object-cover" />
                    </div>

                    {/* Bottom Left Image */}
                    <div className="hidden lg:block h-[196px] border border-gray-800">
                        <img src={getImageUrl("bottom_left.PNG")} className="w-full h-full object-cover" />
                    </div>

                    {/* Bottom Right Image */}
                    <div className="hidden lg:block h-[196px] relative group border border-gray-800">
                        <img
                            src={getImageUrl("bottom_right.PNG")}
                            className="w-full h-full object-cover" />

                        <button
                            className="secondary-button bg-gray-800/50 text-white border-white absolute bottom-4 right-4 shadow-md hover:scale-105 transition-transform"
                            onClick={() => setShowGallery(true)}
                        >
                            View all photos
                        </button>
                    </div>
                </div>

                {/* The line */}
                <hr className="my-6" />

                <div className="mt-10 flex flex-col lg:flex-row gap-12">

                    <div className="flex-1">
                        <h2 className="text-2xl font-bold mb-6">Vehicle Features</h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-12">
                            {PREFERRED_ORDER.map((category) => {
                                const list = car.features[category];
                                if (!list) return null;

                                return (
                                    <div key={category}>
                                        <h3 className="font-bold text-lg mb-3">{category}</h3>
                                        <ul className="space-y-2">
                                            {list.map((feature: string) => (
                                                <li key={feature} className="text-gray-400 font-medium">
                                                    {feature}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                );
                            })}
                        </div>

                        <h4 className="text-2xl font-bold mt-6">Convenience</h4>
                        <h5 className="text-2xl font-bold mt-6">Peace of mind</h5>
                        <h6 className="text-2xl font-bold mt-6">Road rules</h6>

                        <hr className="my-6" />

                        <div className="text-3xl font-bold mt-6">
                            Ratings and reviews
                        </div>


                    </div>

                    {/* Booking Widget */}
                    <div className="w-full lg:w-[400px]">
                        <Card className="sticky top-24 shadow-xl bg-gray-300">
                            <CardContent className="p-6">
                                <div className="flex items-baseline gap-1">
                                    <span className="text-2xl font-bold">${car.price_per_day}</span>
                                    <span className="text-gray-600 font-medium">/ day</span>
                                </div>
                                <p className="text-gray-600 text-sm font-medium mb-6">Including tax and all fees</p>

                                {/* Trip Dates (Placeholders for now) */}
                                <div className="border border-gray-900 rounded-lg mb-3 overflow-hidden">
                                    <div className="p-3 border border-b-gray-900">
                                        <label className="text-xs font-bold text-gray-900">Trip start</label>
                                        <input type="datetime-local" className="w-full outline-none mt-1 bg-transparent" />
                                    </div>
                                    <div className="p-3">
                                        <label className="text-xs font-bold text-gray-900">Trip end</label>
                                        <input type="datetime-local" className="w-full outline-none mt-1 bg-transparent" />
                                    </div>
                                </div>

                                <div className="border border-gray-900 rounded-lg mb-6">
                                    <div className="p-3">
                                        <label> Pick up and return location </label>
                                    </div>

                                </div>

                                <button className="secondary-button rounded-lg w-full text-lg py-6">
                                    Continue
                                </button>
                            </CardContent>
                        </Card>

                        <h2 className="text-xl font-bold mt-6">Cancellation policy</h2>
                        <h2 className="text-xl font-bold mt-6">Distance included</h2>
                        <h2 className="text-xl font-bold mt-6">Insurance & protection</h2>
                    </div>

                </div>

            </div>

        </div>
    )
}