import { createFileRoute } from "@tanstack/react-router"
import { getCarById } from "@/lib/db.ts";
import { useEffect, useRef, useState } from "react";
import { Users, Fuel, Gauge, Settings2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DayPicker, DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import { getBookedDates} from "@/lib/db.ts";

export const Route = createFileRoute("/fleet/$carId")({
    loader: async ({ params }) => {
        const car = await getCarById({ data: params.carId })
        return { car }
    },

    // Meta tag generation to optimize SEO
    head: ({ loaderData }) => ({
        scripts: [
            {
                type: "application/ld+json",
                children: JSON.stringify({
                    "@context": "https://schema.org",
                    "@type": "Car",
                    "name": `${loaderData?.car.year} ${loaderData?.car.make} ${loaderData?.car.model}`,
                    "offers": {
                        "@type": "Offer",
                        "price": loaderData?.car.price_per_day,
                        "priceCurrency": "USD",
                        "availability": "https://schema.org/InStock"
                    },
                    "vehicleTransmission": loaderData?.car.transmission,
                    "fuelType": loaderData?.car.fuel_type,
                    "seatingCapacity": loaderData?.car.num_seats,
                })
            }
        ],
        meta: [
            { title: `${loaderData?.car.year} ${loaderData?.car.make} ${loaderData?.car.model} rental in Saint Paul, MN | Bluefin Rentals` },
            { name: "description", content: `Rent this ${loaderData?.car.year} ${loaderData?.car.make} ${loaderData?.car.model} in Saint Paul. Featuring ${loaderData?.car.num_seats} seats, ${loaderData?.car.mpg} MPG.` },
            { property: "og:title", content: `${loaderData?.car.year} ${loaderData?.car.make} ${loaderData?.car.model} Rental - Bluefin Rentals` },
            { property: "og:description", content: `Rent a ${loaderData?.car.year} ${loaderData?.car.make} ${loaderData?.car.model} in Saint Paul, MN for $${loaderData?.car.price_per_day}/day.` },
            { property: "og:type", content: "website" },
            { property: "og:image", content: `https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${loaderData?.car.id}/main.PNG` },
        ],
    }),
    component: CarDetails,
})

const calendarClassNames = {
    root: "p-0 font-sans",
    months: "flex flex-col",
    month: "space-y-3",
    month_caption: "flex justify-center items-center h-9 relative",
    caption_label: "text-sm font-semibold text-[#d4e8c2] tracking-wide",

    nav: "w-full flex items-center justify-center relative h-5",
    button_previous: [
        "absolute left-2 top-0",
        "w-7 h-7 rounded-md",
        "border border-[#2a4a1e]",
        "inline-flex items-center justify-center",
        "bg-transparent hover:bg-[#1f3318] hover:border-[#4a7a3a]",
        "transition-colors duration-150",
        "cursor-pointer",
    ].join(" "),

    button_next: [
        "absolute right-2 top-0",
        "w-7 h-7 rounded-md",
        "border border-[#2a4a1e]",
        "inline-flex items-center justify-center",
        "bg-transparent hover:bg-[#1f3318] hover:border-[#4a7a3a]",
        "transition-colors duration-150",
        "cursor-pointer",
    ].join(" "),
    month_grid: "w-full border-collapse",
    weekdays: "flex",
    weekday: "w-9 text-center text-[10px] font-medium text-[#6a9455] uppercase tracking-widest pb-1",
    week: "flex mt-1",
    day: "w-9 h-9 text-center text-sm p-0",
    // Default selectable day button
    day_button:
        "w-9 h-9 rounded-full text-sm font-medium text-[#d4e8c2] hover:bg-[#2a4a1e] hover:text-white transition-colors focus:outline-none cursor-pointer",
    // Today
    today: "[&>button]:border [&>button]:border-[#6fcf4a] [&>button]:text-[#6fcf4a]",
    // Selected single day / range start / range end
    selected: [
        "[&>button]:bg-[#3a7d2c]",
        "[&>button]:text-white",
        "[&>button]:rounded-full",
        "[&>button]:hover:bg-[#4a9e38]",
    ].join(" "),

    // Range start: solid green circle + background strip extending RIGHT
    // The strip is painted on the cell itself, behind the button (z-10)
    range_start: [
        "bg-gradient-to-r from-transparent from-50% to-[#1e3d18] to-50%",
        "[&>button]:bg-[#3a7d2c]",
        "[&>button]:text-white",
        "[&>button]:rounded-full",
        "[&>button]:hover:bg-[#4a9e38]",
        "[&>button]:relative [&>button]:z-10",
    ].join(" "),

    // Range end: solid green circle + background strip extending LEFT
    range_end: [
        "bg-gradient-to-r from-[#1e3d18] from-50% to-transparent to-50%",
        "[&>button]:bg-[#3a7d2c]",
        "[&>button]:text-white",
        "[&>button]:rounded-full",
        "[&>button]:hover:bg-[#4a9e38]",
        "[&>button]:relative [&>button]:z-10",
    ].join(" "),

    // Range middle: full background strip, no circle
    range_middle: [
        "bg-[#1e3d18]",
        "[&>button]:bg-transparent",
        "[&>button]:text-[#d4e8c2]",
        "[&>button]:rounded-none",
        "[&>button]:hover:bg-[#2a4a1e]",
        "[&>button]:relative [&>button]:z-10",
    ].join(" "),
    // Past / disabled days (before today)
    disabled: "[&>button]:text-[#3a4f35] [&>button]:cursor-not-allowed [&>button]:hover:bg-transparent",
    // Days outside the current month
    outside: "[&>button]:text-[#2e4429] [&>button]:opacity-40",
    hidden: "invisible",
}

// Strikethrough + gray style applied to booked date cells
const bookedDayClassName =
    "[&>button]:line-through [&>button]:text-[#3d5c38] [&>button]:cursor-not-allowed [&>button]:hover:bg-transparent [&>button]:opacity-60"

function CarDetails() {
    const { car } = Route.useLoaderData()
    const { carId } = Route.useParams()
    const [showGallery, setShowGallery] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [startTime, setStartTime] = useState("10:00");
    const [endTime, setEndTime] = useState("22:00");
    const [airportPickup, setAirportPickup] = useState(true);
    const [customPickup, setCustomPickup] = useState("");

    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [disabledDates, setDisabledDates] = useState<{from: Date; to: Date}[]>([]);

    // ── Click-outside closes the calendar ────────────────────────────────────
    const calendarRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!isCalendarOpen) return;
        function handleClickOutside(e: MouseEvent) {
            if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
                setIsCalendarOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isCalendarOpen]);
    // ─────────────────────────────────────────────────────────────────────────

    // Helper to generate 30 minute time increments for the dropdowns
    const timeOptions = Array.from({ length: 48 }, (_, i) => {
        const hour = Math.floor(i / 2);
        const min = i % 2 === 0 ? "00" : "30";
        const period = hour >= 12 ? "PM" : "AM";
        const displayHour = hour % 12 === 0 ? 12 : hour % 12;
        return { value: `${hour}:${min}`, label: `${displayHour}:${min} ${period}` };
    });

    const start = dateRange?.from;
    const end = dateRange?.to;
    const totalDays = start && end ? Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) : 0;
    const subtotal = totalDays * (car.price_per_day || 0);

    useEffect(() => {
        async function fetchAvailability() {
            const bookings = await getBookedDates({ data: carId });

            const toCST = (dateStr: string) => {
                return new Date(new Date(dateStr).toLocaleString("en-US", { timeZone: "America/Chicago" }));
            };

            const formattedDates = bookings.map((booking: any) => {
                const start = toCST(booking.start_time);
                const end = toCST(booking.end_time);

                return {
                    from: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
                    to: new Date(end?.getFullYear(), end?.getMonth(), end.getDate())
                };
            });

            console.log("Formatted for Calendar:", formattedDates);
            setDisabledDates(formattedDates);
        }
        fetchAvailability();
    }, [carId]);

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
                                alt={`${car.year} ${car.make} ${car.model} - gallery image ${index + 1}`}
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
                <h1 className="mt-12 text-4xl"> {car.year} {car.make} {car.model}</h1>

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

                    {/* Main image */}
                    <div className="lg:col-span-2 lg:row-span-2 relative h-[400px]" >
                        <img
                            src={getImageUrl("main.PNG")}
                            className="w-full h-full object-cover"
                            alt={`${car.year} ${car.make} ${car.model} rental - main view`}
                        />
                    </div>

                    {/* Top Left Image */}
                    <div className="hidden lg:block h-[196px] border border-gray-800">
                        <img
                            src={getImageUrl("top_left.PNG")}
                            className="w-full h-full object-cover"
                            alt={`${car.year} ${car.make} ${car.model} rental - front interior view`}
                        />
                    </div>

                    {/* Top Right Image */}
                    <div className="hidden lg:block h-[196px] border border-gray-800">
                        <img
                            src={getImageUrl("top_right.PNG")}
                            className="w-full h-full object-cover"
                            alt={`${car.year} ${car.make} ${car.model} rental - back view`}
                        />
                    </div>

                    {/* Bottom Left Image */}
                    <div className="hidden lg:block h-[196px] border border-gray-800">
                        <img
                            src={getImageUrl("bottom_left.PNG")}
                            className="w-full h-full object-cover"
                            alt={`${car.year} ${car.make} ${car.model} rental - front view`}
                        />
                    </div>

                    {/* Bottom Right Image */}
                    <div className="hidden lg:block h-[196px] relative group border border-gray-800">
                        <img
                            src={getImageUrl("bottom_right.PNG")}
                            className="w-full h-full object-cover"
                            alt={`${car.year} ${car.make} ${car.model} rental - back interior view`}
                        />

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

                        <h2 className="text-2xl font-bold mt-6">Convenience</h2>
                        <h2 className="text-2xl font-bold mt-6">Peace of mind</h2>
                        <h2 className="text-2xl font-bold mt-6">Road rules</h2>

                        <hr className="my-6" />

                        <h2 className="text-3xl font-bold mt-6">
                            Ratings and reviews
                        </h2>


                    </div>

                    {/* Booking Widget */}
                    <div className="w-full lg:w-[400px] flex flex-col gap-8 lg:self-start">
                        <Card className="top-24 shadow-xl bg-white text-black z-10">
                            <CardContent className="p-6 relative">
                                <div className="flex items-baseline gap-1">
                                    <span className="text-2xl font-bold text-gray-900">${car.price_per_day}</span>
                                    <span className="text-gray-600 font-medium">/ day</span>
                                </div>

                                {totalDays > 0 && (
                                    <div className="mt-4 p-3 bg-gray-100 rounded-lg flex justify-between items-center text-gray-900 font-bold border border-gray-200">
                                        <span>{totalDays} day trip</span>
                                        <span>${subtotal} total</span>
                                    </div>
                                )}

                                <p className="text-gray-600 text-sm font-medium mb-6 mt-2">Including tax and all fees</p>

                                <div className="border border-gray-900 rounded-lg mb-3 bg-white divide-y divide-gray-900 overflow-hidden">
                                    <div className="flex divide-x divide-gray-900">
                                        <button
                                            onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                                            className="flex-1 p-3 text-left hover:bg-gray-50 transition-colors cursor-pointer"
                                        >
                                            <label className="text-[14px] text-gray-900">Trip start</label>
                                            <div className="text-gray-900 font-semibold">{dateRange?.from ? dateRange.from.toLocaleDateString() : "Select Date"}</div>
                                        </button>
                                        <div className="w-[120px] p-3">
                                            <select
                                                value={startTime}
                                                onChange={(e) => setStartTime(e.target.value)}
                                                className="w-full bg-transparent outline-none text-gray-900 font-semibold mt-4 text-sm cursor-pointer"
                                            >
                                                {timeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="flex divide-x divide-gray-900">
                                        <button
                                            onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                                            className="flex-1 p-3 text-left hover:bg-gray-50 transition-colors cursor-pointer"
                                        >
                                            <label className="text-[14px] text-gray-900">Trip end</label>
                                            <div className="text-gray-900 font-semibold">{dateRange?.to ? dateRange.to.toLocaleDateString() : "Select Date"}</div>
                                        </button>
                                        <div className="w-[120px] p-3">
                                            <select
                                                value={endTime}
                                                onChange={(e) => setEndTime(e.target.value)}
                                                className="w-full bg-transparent outline-none text-gray-900 font-semibold mt-4 text-sm cursor-pointer"
                                            >
                                                {timeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                {/* Calendar popup */}
                                {isCalendarOpen && (
                                    <div
                                        ref={calendarRef}
                                        className="absolute top-[220px] left-[-20px] z-[110] bg-[#152110] p-5 shadow-2xl rounded-2xl border border-[#2a4a1e]"
                                    >
                                        <DayPicker
                                            mode="range"
                                            selected={dateRange}
                                            onSelect={(range) => {
                                                setDateRange(range);
                                                if (range?.from && range?.to) setIsCalendarOpen(false);
                                            }}
                                            disabled={[{ before: new Date() }, ...disabledDates]}
                                            modifiers={{ booked: disabledDates }}
                                            modifiersClassNames={{ booked: bookedDayClassName }}
                                            classNames={calendarClassNames}
                                        />
                                    </div>
                                )}

                                <div className="border border-gray-900 rounded-lg mb-6 p-3">
                                    <label className="text-[14px] font-semibold text-gray-900">Pickup & return location</label>
                                    {/*<div className="text-gray-900 font-semibold">Saint Paul, MN</div>*/}

                                    {/* Airport pickup checkbox */}
                                    <div className="mt-3 flex items-center gap-2">
                                        <label htmlFor="airportPickup" className="text-sm text-gray-700 cursor-pointer">
                                            MSP Airport pickup
                                        </label>
                                        <input
                                            type="checkbox"
                                            id="airportPickup"
                                            checked={airportPickup}
                                            onChange={(e) => setAirportPickup(e.target.checked)}
                                            className="w-3 h-3 accent-gray-800 cursor-pointer"
                                        />
                                    </div>

                                    {/* Custom address — only shown when airport pickup is unchecked */}
                                    {!airportPickup && (
                                        <div className="mt-3">
                                            <input
                                                type="text"
                                                placeholder="Enter pickup address"
                                                value={customPickup}
                                                onChange={(e) => setCustomPickup(e.target.value)}
                                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-600 transition-colors"
                                            />
                                            <p className="text-xs text-gray-500 mt-1">
                                                Additional fees apply for custom pickup locations.
                                            </p>
                                        </div>
                                    )}
                                </div>

                                <button className="secondary-button bg-white rounded-lg w-full text-lg py-6 shadow-lg transition-all">
                                    Continue
                                </button>
                            </CardContent>
                        </Card>

                        <div className="mt-4 space-y-4 relative">
                            <p className="text-lg font-bold">Cancellation policy</p>
                            <p className="text-lg font-bold">Distance included</p>
                            <p className="text-lg font-bold">Insurance & protection</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}