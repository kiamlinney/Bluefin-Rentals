import {createFileRoute, Link, useNavigate} from "@tanstack/react-router"
import { getCarById } from "@/lib/db.ts";
import { useEffect, useRef, useMemo, useState } from "react";
import { Users, Fuel, Gauge, Settings2, X, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { getBookedDates} from "@/lib/db.ts";
import { getUser } from "@/lib/auth.ts";

export const Route = createFileRoute("/fleet/$carId")({
    loader: async ({ params }) => {
        const car = await getCarById({ data: params.carId })
        const user = await getUser().catch(() => null)
        return { car, user }
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

type TimeOption = { value: string; label: string; disabled: boolean };

function TimeDropdown({ value, onChange, options }: {
    value: string;
    onChange: (v: string) => void;
    options: TimeOption[];
}) {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [isOpen]);

    const selected = options.find(o => o.value === value);

    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen || !scrollRef.current) return;

        // Find the selected button, or fall back to the first enabled one
        const selected = scrollRef.current.querySelector('[data-selected="true"]') as HTMLElement;
        const firstEnabled = scrollRef.current.querySelector('[data-disabled="false"]') as HTMLElement;
        const target = selected ?? firstEnabled;

        if (target) {
            // scrollIntoView with block:"center" puts the item in the middle of the visible area
            target.scrollIntoView({ block: "center" });
        }
    }, [isOpen]);

    return (
        <div ref={ref} className="relative w-[120px] p-3 flex-shrink-0">
            <button
                type="button"
                onClick={() => setIsOpen(o => !o)}
                className="w-full flex items-center justify-between text-gray-900 font-semibold text-sm mt-4 cursor-pointer"
            >
                <span>{selected?.label ?? value}</span>
                <ChevronDown size={14} className={`text-gray-500 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <div ref={scrollRef} className="absolute top-full right-0 z-[120] bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-scroll time-dropdown-scroll">
                    {options.map(opt => (
                        <button
                            key={opt.value}
                            type="button"
                            data-selected={opt.value === value ? "true" : "false"}
                            data-disabled={opt.disabled ? "true" : "false"}
                            onClick={() => {
                                if (!opt.disabled) { onChange(opt.value); setIsOpen(false); }
                            }}
                            className={[
                                "w-full text-left px-3 py-2 text-sm",
                                opt.disabled
                                    ? "text-gray-300 cursor-not-allowed"
                                    : opt.value === value
                                        ? "bg-gray-100 text-gray-900 font-semibold cursor-pointer"
                                        : "text-gray-900 hover:bg-gray-50 cursor-pointer"
                            ].join(" ")}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

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
    const { car, user } = Route.useLoaderData()
    const { carId } = Route.useParams()
    const navigate = useNavigate()
    const [showGallery, setShowGallery] = useState(false);
    const [startTime, setStartTime] = useState("10:00");
    const [endTime, setEndTime] = useState("22:00");
    const [airportPickup, setAirportPickup] = useState(true);
    const [customPickup, setCustomPickup] = useState("");

    const [disabledDates, setDisabledDates] = useState<{from: Date; to: Date}[]>([]);

    const [startDate, setStartDate] = useState<Date | undefined>(undefined);
    const [endDate, setEndDate] = useState<Date | undefined>(undefined);
    const [isStartCalendarOpen, setIsStartCalendarOpen] = useState(false);
    const [isEndCalendarOpen, setIsEndCalendarOpen] = useState(false);
    const startCalendarRef = useRef<HTMLDivElement>(null);
    const endCalendarRef = useRef<HTMLDivElement>(null);
    const startTriggerRef = useRef<HTMLButtonElement>(null);
    const endTriggerRef = useRef<HTMLButtonElement>(null);

    // Calendar Functionality -------------------------------------------------------------------------------------------
    // Clicking outside closes the calendar
    useEffect(() => {
        if (!isStartCalendarOpen) return;
        function handleClick(e: MouseEvent) {
            if (startCalendarRef.current && !startCalendarRef.current.contains(e.target as Node) &&
                startTriggerRef.current && !startTriggerRef.current.contains(e.target as Node))
            {
                setIsStartCalendarOpen(false);
            }

        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [isStartCalendarOpen]);

    useEffect(() => {
        if (!isEndCalendarOpen) return;
        function handleClick(e: MouseEvent) {
            if (endCalendarRef.current && !endCalendarRef.current.contains(e.target as Node) &&
                endTriggerRef.current && !endTriggerRef.current.contains(e.target as Node))
            {
                setIsStartCalendarOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [isEndCalendarOpen]);

    // So both calendars cannot be open at the same time
    const toggleStartCalendar = () => {
        setIsStartCalendarOpen(o => !o);
        setIsEndCalendarOpen(false);
    };
    const toggleEndCalendar = () => {
        setIsEndCalendarOpen(o => !o);
        setIsStartCalendarOpen(false);
    };

    const handleStartSelect = (date: Date | undefined) => {
        setStartDate(date);
        // If new start is after existing end, clear end — trip can't end before it starts
        if (date && endDate && date > endDate) setEndDate(undefined);
        setIsStartCalendarOpen(false);
    };

    const handleEndSelect = (date: Date | undefined) => {
        setEndDate(date);
        setIsEndCalendarOpen(false);
    };

    const rangeModifiers = useMemo(() => {
        if (!startDate || !endDate) return {};
        return {
            rangeStart: startDate,
            rangeEnd: endDate,
            // Function modifier — RDP calls this for every visible day.
            // Returns true if the date falls strictly between start and end.
            rangeMiddle: (date: Date) => date > startDate && date < endDate,
        };
    }, [startDate, endDate]);

    const rangeModifierClassNames = {
        rangeStart: [
            "bg-gradient-to-r from-transparent from-50% to-[#1e3d18] to-50%",
            "[&>button]:bg-[#3a7d2c] [&>button]:text-white",
            "[&>button]:rounded-full [&>button]:relative [&>button]:z-10",
        ].join(" "),
        rangeEnd: [
            "bg-gradient-to-r from-[#1e3d18] from-50% to-transparent to-50%",
            "[&>button]:bg-[#3a7d2c] [&>button]:text-white",
            "[&>button]:rounded-full [&>button]:relative [&>button]:z-10",
        ].join(" "),
        rangeMiddle: [
            "bg-[#1e3d18]",
            "[&>button]:bg-transparent [&>button]:text-[#d4e8c2]",
            "[&>button]:rounded-none [&>button]:relative [&>button]:z-10",
            "[&>button]:hover:bg-[#2a4a1e]",
        ].join(" "),
    };

    // ------------------------------------------------------------------------------------------------------------------------

    const baseTimeOptions = useMemo(() => {
        return Array.from({ length: 48 }, (_, i) => {
            const totalMinutes = i * 30; // starts at midnight (0 min)
            const hour = Math.floor(totalMinutes / 60);
            const min = totalMinutes % 60;
            const minStr = min === 0 ? "00" : "30";
            const period = hour >= 12 ? "PM" : "AM";
            const displayHour = hour % 12 === 0 ? 12 : hour % 12;

            // Business hours: 10:00 AM (600 min) to 10:30 PM (1350 min)
            const outOfHours = totalMinutes < 600 || totalMinutes > 1350;

            return {
                value: `${hour}:${minStr}`,
                label: `${displayHour}:${minStr} ${period}`,
                disabled: outOfHours,
            };
        });
    }, []);

    const timeToMinutes = (time: string): number => {
        const parts = time.split(':');
        return Number(parts[0] ?? 0) * 60 + Number(parts[1] ?? 0);
    };

    const isSameDay = useMemo(() => {
        if (!startDate || !endDate) return false;
        const f = startDate;
        const t = endDate;
        return (
            f.getFullYear() === t.getFullYear() &&
            f.getMonth() === t.getMonth() &&
            f.getDate() === t.getDate()
        );
    }, [startDate, endDate]);

    // Start options: disable slots >= endTime on same-day trips.
    const startTimeOptions = useMemo(() => {
        if (!isSameDay) return baseTimeOptions;
        const endMinutes = timeToMinutes(endTime);
        return baseTimeOptions.map(t => ({
            ...t,
            disabled: t.disabled || timeToMinutes(t.value) >= endMinutes,
        }));
    }, [isSameDay, endTime, baseTimeOptions]);

    // End options: disable slots <= startTime on same-day trips.
    const endTimeOptions = useMemo(() => {
        if (!isSameDay) return baseTimeOptions;
        const startMinutes = timeToMinutes(startTime);
        return baseTimeOptions.map(t => ({
            ...t,
            disabled: t.disabled || timeToMinutes(t.value) <= startMinutes,
        }));
    }, [isSameDay, startTime, baseTimeOptions]);

    const combineDateTime = (date: Date, timeStr: string) => {
        const parts = timeStr.split(':');
        const hours = Number(parts[0] ?? 0);
        const minutes = Number(parts[1] ?? 0);
        const d = new Date(date);
        d.setHours(hours, minutes, 0, 0);
        return d;
    };

    const calculateTotalDays = () => {
        if (!startDate || !endDate) return 0;

        const startWithTime = combineDateTime(startDate, startTime);
        const endWithTime = combineDateTime(endDate, endTime);

        const diffInMs = endWithTime.getTime() - startWithTime.getTime();

        return diffInMs / (1000 * 60 * 60 * 24);
    };

    const totalDurationDays = calculateTotalDays();
    const totalDays = Math.ceil(totalDurationDays);
    const subtotal = totalDays * car.price_per_day;

    const durationError = useMemo(() => {
        if (!startDate || !endDate) return null;
        if (totalDurationDays < 1) return "Minimum trip duration is 24 hours. Please adjust your dates or times.";
        return null;
    }, [startDate, endDate, totalDurationDays]);

    const isButtonDisabled = !startDate || !endDate || totalDurationDays < 1;

    useEffect(() => {
        async function fetchAvailability() {
            const bookings = await getBookedDates({ data: carId });

            const formattedDates = bookings.map((booking: any) => {
                const start = new Date(booking.start_time);
                const end = new Date(booking.end_time);

                return {
                    from: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
                    to: new Date(end?.getFullYear(), end?.getMonth(), end.getDate())
                };
            });

            console.log("Formatted for Calendar:", formattedDates);
            setDisabledDates(formattedDates);
        }
        void fetchAvailability();
    }, [carId]);

    const handleContinue = () => {
        if (!startDate || !endDate || totalDurationDays < 1) return; // safety guard

        void navigate({
            to: '/checkout/$carId',
            params: { carId },
            search: {
                startDate: startDate.toLocaleDateString('en-CA'),
                endDate: endDate.toLocaleDateString('en-CA'),
                startTime,
                endTime,
                totalDays,
                subtotal,
                pickupLocation: airportPickup ? 'MSP Airport' : customPickup,
            }
        })
    }

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
                    <div className="flex items-center gap-2 bg-gray-200 px-4 py-2 rounded-lg text-sm">
                        <Users size={18} /> {car.num_seats} seats
                    </div>
                    <div className="flex items-center gap-2 bg-gray-200 px-4 py-2 rounded-lg text-sm">
                        <Fuel size={18} /> {car.fuel_type}
                    </div>
                    <div className="flex items-center gap-2 bg-gray-200 px-4 py-2 rounded-lg text-sm">
                        <Gauge size={18} /> {car.mpg} MPG
                    </div>
                    <div className="flex items-center gap-2 bg-gray-200 px-4 py-2 rounded-lg text-sm">
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

                    {/* -------------------------------- Booking Widget --------------------------------  */}
                    <div className="w-full lg:w-[400px] flex flex-col gap-8 lg:self-start">
                        {user ? (
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

                                    <div className="border border-gray-900 rounded-lg mb-3 bg-white divide-y divide-gray-900">

                                        {/* Trip start row */}
                                        <div className="relative">

                                            <div className="relative flex divide-x divide-gray-900">
                                                <button
                                                    ref={startTriggerRef}
                                                    onClick={toggleStartCalendar}
                                                    className="flex-1 p-3 text-left transition-colors cursor-pointer"
                                                >
                                                    <label className="text-[14px] text-gray-900">Trip start</label>
                                                    <div className="text-gray-900 font-semibold">
                                                        {startDate ? startDate.toLocaleDateString() : "Select Date"}
                                                    </div>
                                                </button>
                                                <TimeDropdown value={startTime} onChange={setStartTime} options={startTimeOptions} />
                                            </div>

                                                {isStartCalendarOpen && (
                                                    <div ref={startCalendarRef}
                                                         className="absolute top-full left-0 z-[110] bg-[#152110] p-5 shadow-2xl rounded-2xl border border-[#2a4a1e]">
                                                        <DayPicker
                                                            mode="single"
                                                            selected={startDate}
                                                            onSelect={handleStartSelect}
                                                            defaultMonth={startDate ?? new Date()}
                                                            disabled={[{ before: new Date() }, ...disabledDates]}
                                                            modifiers={{ ...rangeModifiers, booked: disabledDates }}
                                                            modifiersClassNames={{ ...rangeModifierClassNames, booked: bookedDayClassName }}
                                                            classNames={calendarClassNames}
                                                        />
                                                    </div>
                                                )}
                                        </div>


                                        {/* Trip end row */}
                                        <div className="relative">

                                            <div className="relative flex divide-x divide-gray-900">
                                                <button
                                                    ref={endTriggerRef}
                                                    onClick={toggleEndCalendar}
                                                    className="flex-1 p-3 text-left transition-colors cursor-pointer"
                                                >
                                                    <label className="text-[14px] text-gray-900">Trip end</label>
                                                    <div className="text-gray-900 font-semibold">
                                                        {endDate ? endDate.toLocaleDateString() : "Select Date"}
                                                    </div>
                                                </button>
                                                <TimeDropdown value={endTime} onChange={setEndTime} options={endTimeOptions} />
                                            </div>

                                                {isEndCalendarOpen && (
                                                    <div ref={endCalendarRef}
                                                         className="absolute top-full left-0 z-[110] bg-[#152110] p-5 shadow-2xl rounded-2xl border border-[#2a4a1e]">
                                                        <DayPicker
                                                            mode="single"
                                                            selected={endDate}
                                                            onSelect={handleEndSelect}
                                                            defaultMonth={endDate ?? startDate ?? new Date()}
                                                            disabled={[{ before: startDate ?? new Date() }, ...disabledDates]}
                                                            modifiers={{ ...rangeModifiers, booked: disabledDates }}
                                                            modifiersClassNames={{ ...rangeModifierClassNames, booked: bookedDayClassName }}
                                                            classNames={calendarClassNames}
                                                        />
                                                    </div>
                                                )}
                                        </div>

                                    </div>

                                    <div className="border border-gray-900 rounded-lg mb-6 p-3">
                                        <label className="text-[14px] font-semibold text-gray-900">Pickup & return location</label>

                                        {/* Airport pickup checkbox */}
                                        <div className="mt-3 flex items-center gap-2">
                                            <label htmlFor="airportPickup" className="text-sm text-gray-700 cursor-pointer">
                                                MSP Airport
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

                                    {durationError && (
                                        <div className="flex items-start gap-2 text-red-500 text-sm mb-3">
                                            <span className="mt-0.5 flex-shrink-0">⚠</span>
                                            <span>{durationError}</span>
                                        </div>
                                    )}

                                    <button
                                        onClick={handleContinue}
                                        disabled={isButtonDisabled}
                                        className={[
                                            "secondary-button bg-white rounded-lg w-full text-lg py-6 shadow-lg transition-all",
                                            isButtonDisabled ? "opacity-50 cursor-not-allowed" : ""
                                        ].join(" ")}
                                    >
                                        Continue
                                    </button>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card className="top-24 shadow-xl bg-white text-black z-10">
                                <CardContent className="p-6 text-center space-y-4">
                                    <p className="text-gray-900 font-semibold text-lg">
                                        Please login to book a vehicle
                                    </p>
                                    <p className="text-gray-500 text-sm">
                                        Create an account or login to continue.
                                    </p>
                                    <Link
                                        to="/login"
                                        search={{ redirect: `/fleet/${carId}` }}
                                        className="block w-full py-3 bg-gray-900 shadow-lg text-white rounded-full font-medium hover:scale-101 transition-colors"
                                    >
                                        Login or Sign Up
                                    </Link>
                                </CardContent>
                            </Card>
                        )}


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