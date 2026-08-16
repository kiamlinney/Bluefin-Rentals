import {createFileRoute, Link, useNavigate} from "@tanstack/react-router"
import { getCarById } from "@/lib/db.ts";
import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { z } from "zod";
import { Users, Fuel, Gauge, Settings2, X, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getBookedDates, getCarPriceOverrides } from "@/lib/db.ts";
import { getUser } from "@/lib/auth.ts";
import {
    buildOverrideMap,
    calculateTripPrice,
    dateKeyToLocalDate,
    getTripDurationMinutes,
    timeToMinutes,
    toDateKey,
    type PriceOverrides,
} from "@/lib/pricing.ts";
import { businessDayStart, formatDateKey } from "@/lib/dates.ts";
import { findUnavailableDays, spansToDateKeys } from "@/lib/availability.ts";
import { TripCalendar } from "@/components/TripCalendar.tsx";
import { PriceBreakdown } from "@/components/PriceBreakdown.tsx";
import { PickupLocationPicker } from "@/components/PickupLocationPicker.tsx";
import { DEFAULT_PICKUP, resolvePickup, type PickupSelection } from "@/lib/pickup.ts";

// Optional because most visitors arrive without dates. `.catch(undefined)` so a
// hand-mangled URL renders an empty picker instead of an error boundary.
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const carSearchSchema = z.object({
    start: z.string().regex(DATE_KEY).optional().catch(undefined),
    end: z.string().regex(DATE_KEY).optional().catch(undefined),
})

export const Route = createFileRoute("/fleet/$carId")({
    validateSearch: carSearchSchema,
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
        <div ref={ref} className="relative flex-1">
            <button
                type="button"
                onClick={() => setIsOpen(o => !o)}
                className="w-full flex items-center justify-between border border-gray-300 rounded-lg px-4 py-3 text-gray-900 text-sm hover:border-gray-400 transition-colors cursor-pointer"
            >
                <span>{selected?.label ?? value}</span>
                <ChevronDown size={14} className={`text-gray-500 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <div
                    ref={scrollRef}
                    className="absolute top-full left-0 right-0 mt-1 z-[120] bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-scroll time-dropdown-scroll"
                >
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

// Goes through src/lib/dates.ts rather than `new Date(key)`: a 'YYYY-MM-DD'
// string parses as UTC midnight and renders as the previous day west of
// Greenwich.
const formatDayKey = (key: string) =>
    formatDateKey(key, { month: "short", day: "numeric" });

// "Aug 12, Aug 13 and 2 more days" — name the days that actually collide so the
// customer can see which end of their range to move, without listing thirty.
const unavailableMessage = (keys: string[]) => {
    const shown = keys.slice(0, 3).map(formatDayKey);
    const rest = keys.length - shown.length;
    const list =
        rest > 0
            ? `${shown.join(", ")} and ${rest} more day${rest > 1 ? "s" : ""}`
            : shown.length > 1
                ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`
                : shown[0];
    return `This car is already booked on ${list}. Please choose different dates.`;
};

// Pinned locale: with dates prefilled from the URL these labels now render on
// the server too, and Node's default locale needn't match the browser's.
const formatTriggerDate = (d: Date) => d.toLocaleDateString("en-US");

function CarDetails() {
    const { car, user } = Route.useLoaderData()
    const { carId } = Route.useParams()
    const search = Route.useSearch()
    const navigate = useNavigate()
    const [showGallery, setShowGallery] = useState(false);
    const [startTime, setStartTime] = useState("10:00");
    const [endTime, setEndTime] = useState("22:00");
    // One selection, replacing the two independent checkboxes and free-text field
    // this widget used to carry. Those three could disagree — both boxes ticked,
    // or a box ticked *and* an address typed — and the conflict was resolved
    // invisibly by the ordering of a ternary chain in handleContinue. A single
    // discriminated union (src/lib/pickup.ts) makes that state impossible to
    // reach rather than merely unlikely.
    const [pickup, setPickup] = useState<PickupSelection>(DEFAULT_PICKUP);

    const [disabledDates, setDisabledDates] = useState<{from: Date; to: Date}[]>([]);
    const [availabilityLoaded, setAvailabilityLoaded] = useState(false);
    const [priceOverrides, setPriceOverrides] = useState<PriceOverrides>({});
    const [showPriceDetails, setShowPriceDetails] = useState(false);

    // Seeded from the search bar's dates via the URL. Lazy initialisers, not a
    // binding: once the widget is mounted the customer's own edits win, since
    // these are the very fields they're editing.
    const [startDate, setStartDate] = useState<Date | undefined>(
        () => dateKeyToLocalDate(search.start) ?? undefined,
    );
    const [endDate, setEndDate] = useState<Date | undefined>(
        () => dateKeyToLocalDate(search.end) ?? undefined,
    );
    const [isStartCalendarOpen, setIsStartCalendarOpen] = useState(false);
    const [isEndCalendarOpen, setIsEndCalendarOpen] = useState(false);
    const startTriggerRef = useRef<HTMLButtonElement>(null);
    const endTriggerRef = useRef<HTMLButtonElement>(null);

    // Calendar Functionality -------------------------------------------------------------------------------------------
    // Outside-click and Escape live inside TripCalendar, which is why there are
    // no listeners here. These only keep the two popovers mutually exclusive.
    const toggleStartCalendar = () => {
        setIsStartCalendarOpen(o => !o);
        setIsEndCalendarOpen(false);
    };
    const toggleEndCalendar = () => {
        setIsEndCalendarOpen(o => !o);
        setIsStartCalendarOpen(false);
    };

    const closeStartCalendar = useCallback(() => setIsStartCalendarOpen(false), []);
    const closeEndCalendar = useCallback(() => setIsEndCalendarOpen(false), []);

    const handleStartSelect = useCallback((date: Date) => {
        setStartDate(date);
        // A start after the current end invalidates that end, so it's cleared —
        // and a cleared or absent end is exactly the case where the customer
        // still owes us an end date, so we open that calendar for them. Merely
        // nudging the start of an already-valid range leaves it closed.
        const needsEnd = !endDate || date > endDate;
        if (endDate && date > endDate) setEndDate(undefined);
        setIsStartCalendarOpen(false);
        setIsEndCalendarOpen(needsEnd);
    }, [endDate]);

    const handleEndSelect = useCallback((date: Date) => {
        setEndDate(date);
        setIsEndCalendarOpen(false);
    }, []);

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

    // Duration comes from the pricing module rather than local Date math so the
    // 24-hour minimum enforced here is measured exactly the way billing measures
    // it — no chance of the button enabling a trip the server then rejects.
    const totalDurationDays = useMemo(() => {
        if (!startDate || !endDate) return 0;
        return getTripDurationMinutes(
            toDateKey(startDate), startTime, toDateKey(endDate), endTime,
        ) / (60 * 24);
    }, [startDate, endDate, startTime, endTime]);

    // What the chosen pickup costs, what to call it, and whether it can be booked
    // at all. Resolved from the same table the server re-resolves against, so the
    // fee shown here is the fee charged — see src/lib/pickup.ts.
    const resolvedPickup = useMemo(() => resolvePickup(pickup), [pickup]);

    // The trip's price, resolved per day against the admin's price overrides and
    // then discounted by duration. calculateTripPrice is the same function the
    // server runs in createCheckoutSession, so what's quoted here is what gets
    // charged — see src/lib/pricing.ts.
    const quote = useMemo(() => calculateTripPrice({
        startDate: startDate ? toDateKey(startDate) : "",
        startTime,
        endDate: endDate ? toDateKey(endDate) : "",
        endTime,
        // Postgres `numeric` can arrive as a string depending on how PostgREST
        // serializes it — Number() keeps the arithmetic from concatenating.
        basePricePerDay: Number(car.price_per_day),
        overrides: priceOverrides,
        // Feeding the fee through the quote rather than adding it to the total
        // afterwards is what makes it show up everywhere for free: the "$X total"
        // button, the Continue navigation and the price-details modal all read
        // `quote`, and none of them needed changing.
        pickupFee: resolvedPickup.fee,
        pickupFeeLabel: resolvedPickup.feeLabel,
    }), [startDate, endDate, startTime, endTime, car.price_per_day, priceOverrides, resolvedPickup]);

    const totalDays = quote.billableDays;
    const subtotal = quote.total;

    const blockedDayKeys = useMemo(() => spansToDateKeys(disabledDates), [disabledDates]);

    // Both pickers already refuse a booked day as an *endpoint*, but nothing
    // stopped a start before a booked block and an end after it — the whole
    // block sat inside the range and the trip only failed at the Stripe payment
    // step, after driver info and identity verification.
    const unavailableDays = useMemo(() => {
        if (!startDate || !endDate) return [];
        return findUnavailableDays(toDateKey(startDate), toDateKey(endDate), blockedDayKeys);
    }, [startDate, endDate, blockedDayKeys]);

    // One message at a time, duration first: a sub-24h range is fixable by
    // nudging a time, and its conflicting-days list would be a confusing single
    // day. An unavailable range always needs different dates, so it comes last.
    //
    // The pickup error is checked *before* the date guard rather than inside it,
    // because it's the one problem here that has nothing to do with dates: an
    // out-of-area delivery address is just as wrong on an empty calendar as on a
    // full one, and staying silent about it until dates are picked would let a
    // customer choose their days before finding out the location was never
    // bookable. Among the date-dependent messages it stays last — those two are
    // the commoner mistakes, and the picker already shows its own message inline.
    const validationError = useMemo(() => {
        if (resolvedPickup.error) return resolvedPickup.error;
        if (!startDate || !endDate) return null;
        if (totalDurationDays < 1) return "Minimum trip duration is 24 hours. Please adjust your dates or times.";
        if (unavailableDays.length > 0) return unavailableMessage(unavailableDays);
        return null;
    }, [startDate, endDate, totalDurationDays, unavailableDays, resolvedPickup]);

    // availabilityLoaded closes the window where a range prefilled from the
    // search bar could reach checkout before we know what's booked.
    const isButtonDisabled =
        !startDate || !endDate || !availabilityLoaded || validationError !== null;

    useEffect(() => {
        async function fetchAvailability() {
            const [bookings, overrides] = await Promise.all([
                getBookedDates({ data: carId }),
                getCarPriceOverrides({ data: carId }),
            ]);

            setPriceOverrides(buildOverrideMap(overrides));

            // Which days a booking occupies is decided in business time, not in
            // the visitor's. Reading the day off the instant with getDate() made
            // a 10pm Central return spill into the next day for anyone at or east
            // of UTC, greying out a day that's actually free to book.
            const formattedDates = bookings.map((booking: any) => ({
                from: businessDayStart(booking.start_time),
                to: businessDayStart(booking.end_time),
            }));

            setDisabledDates(formattedDates);
        }
        void fetchAvailability().finally(() => setAvailabilityLoaded(true));
    }, [carId]);

    const handleContinue = () => {
        // Same condition the button uses; the date checks are repeated only so
        // TypeScript narrows them for the search params below.
        if (isButtonDisabled || !startDate || !endDate) return;

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
                // Two representations of the same choice, deliberately.
                //
                // `pickupLocation` is the human-readable string the checkout page
                // prints in its trip summary. It's for reading, not for deciding:
                // every one of these params is in the URL and therefore editable,
                // so a fee derived from this string would be a fee the customer
                // can rewrite.
                //
                // The structured fields below are what the server re-resolves
                // against src/lib/pickup.ts to recompute the real fee — the same
                // reason `subtotal` is treated as a display hint and re-priced in
                // createCheckoutSession.
                // The delivery coordinates deliberately stay behind. This page
                // needed them to price and pre-validate the choice, but the
                // server geocodes the address text rather than trusting numbers
                // it was handed — so sending them would only add a field a
                // customer could edit and nothing would read.
                pickupLocation: resolvedPickup.label,
                pickupKind: pickup.kind,
                pickupId: pickup.kind === 'listed' ? pickup.id : undefined,
                pickupAddress: pickup.kind === 'delivery' ? pickup.address : undefined,
            }
        })
    }

    const projectID = "fmueikfpthimanfrituz"
    const getImageUrl = (fileName: string) =>
        `https://${projectID}.supabase.co/storage/v1/object/public/car%20gallery/car_${carId}/${fileName}`

    const images = car.gallery_images || [];
    const PREFERRED_ORDER = ["Safety", "Device connectivity", "Convenience", "Additional features"];

  
    const features = (car.features ?? {}) as Record<string, unknown>;

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
        <div className="container mx-auto p-4 md:p-8">
            {/* Info & Specs */}
            <div className="flex-1">
                <h1 className="mt-12 text-4xl"> {car.make} {car.model} {car.year}</h1>

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
                                const raw = features[category];
                                const list = Array.isArray(raw)
                                    ? raw.filter((f): f is string => typeof f === 'string')
                                    : [];
                                if (list.length === 0) return null;

                                return (
                                    <div key={category}>
                                        <h3 className="font-bold text-lg mb-3">{category}</h3>
                                        <ul className="space-y-2">
                                            {list.map((feature) => (
                                                <li key={feature} className="text-gray-300 font-medium">
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
                                        <span className="text-gray-600 font-medium mb-4">/ day</span>
                                    </div>

                                    <hr className="border-gray-200" />

                                    {totalDays > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setShowPriceDetails(true)}
                                            className="mt-4 w-full p-3 bg-gray-100 rounded-lg flex justify-between items-center text-gray-900 font-bold border border-gray-200 hover:bg-gray-200 transition-colors cursor-pointer"
                                        >
                                            <span className="flex items-center gap-1.5">
                                                {totalDays} day trip
                                                <ChevronDown size={14} className="text-gray-500" />
                                            </span>
                                            <span className="flex items-baseline gap-2">
                                                {/* Show what the trip would have cost without the
                                                    duration discounts, so the saving is visible. */}
                                                {quote.discountAmount + quote.extraDiscountAmount > 0 && (
                                                    <span className="text-gray-500 font-medium line-through">
                                                        ${quote.subtotal.toFixed(2)}
                                                    </span>
                                                )}
                                                ${subtotal.toFixed(2)} total
                                            </span>
                                        </button>
                                    )}

                                    <p className="text-gray-600 text-sm font-medium mb-6 mt-2">
                                        {totalDays > 0 && "Click for price details"}
                                    </p>

                                    <div className="space-y-4 mb-6">

                                        {/* Trip start row */}
                                        <div className="relative">

                                            <label className="block text-sm tex-gray-900 mb-1.5">Trip start</label>

                                            <div className="flex gap-3">
                                                <button
                                                    ref={startTriggerRef}
                                                    onClick={toggleStartCalendar}
                                                    className="flex-[1.3] flex items-center justify-between border border-gray-300 rounded-lg px-4 py-3 text-gray-900 text-sm hover:border-gray-400 transition-colors cursor-pointer"
                                                >
                                                    <span>{startDate ? formatTriggerDate(startDate) : "Select Date"}</span>
                                                    <ChevronDown size={14} className="text-gray-500" />
                                                </button>

                                                <TimeDropdown value={startTime} onChange={setStartTime} options={startTimeOptions} />
                                            </div>

                                                <TripCalendar
                                                    mode="start"
                                                    open={isStartCalendarOpen}
                                                    onClose={closeStartCalendar}
                                                    triggerRef={startTriggerRef}
                                                    startDate={startDate}
                                                    endDate={endDate}
                                                    onSelectStart={handleStartSelect}
                                                    unavailableRanges={disabledDates}
                                                />
                                        </div>


                                        {/* Trip end row */}
                                        <div className="relative">

                                            <label className="block text-sm tex-gray-900 mb-1.5">Trip end</label>

                                            <div className="flex gap-3">
                                                <button
                                                    ref={endTriggerRef}
                                                    onClick={toggleEndCalendar}
                                                    className="flex-[1.3] flex items-center justify-between border border-gray-300 rounded-lg px-4 py-3 text-gray-900 text-sm hover:border-gray-400 transition-colors cursor-pointer"
                                                >
                                                    <span>{endDate ? formatTriggerDate(endDate) : "Select Date"}</span>
                                                    <ChevronDown size={14} className="text-gray-500" />
                                                </button>

                                                <TimeDropdown value={endTime} onChange={setEndTime} options={endTimeOptions} />
                                            </div>

                                                {/* Gets startDate too, so the chosen start shows as the head of
                                                    the range here rather than the grid looking untouched. */}
                                                <TripCalendar
                                                    mode="end"
                                                    open={isEndCalendarOpen}
                                                    onClose={closeEndCalendar}
                                                    triggerRef={endTriggerRef}
                                                    startDate={startDate}
                                                    endDate={endDate}
                                                    onSelectEnd={handleEndSelect}
                                                    unavailableRanges={disabledDates}
                                                />
                                        </div>

                                        <hr className="border-gray-200" />

                                        <PickupLocationPicker
                                            value={pickup}
                                            onChange={setPickup}
                                        />

                                        <hr className="border-gray-200" />

                                    </div>

                                    {validationError && (
                                        <div className="flex items-start gap-2 text-red-500 text-sm mb-3">
                                            <span className="mt-0.5 flex-shrink-0">⚠</span>
                                            <span>{validationError}</span>
                                        </div>
                                    )}

                                    <button
                                        onClick={handleContinue}
                                        disabled={isButtonDisabled}
                                        className={[
                                            "border border-gray-300 bg-white rounded-lg w-full text-lg py-6 shadow-lg transition-all hover:border-gray-400",
                                            isButtonDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
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
                                        // Carry the dates through the round trip: the booking widget
                                        // only renders when logged in, so without this a customer who
                                        // arrives from the search bar comes back to empty calendars.
                                        search={{
                                            redirect: search.start && search.end
                                                ? `/fleet/${carId}?start=${search.start}&end=${search.end}`
                                                : `/fleet/${carId}`,
                                        }}
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

            {/* Rendered outside the booking card so its backdrop covers the page
                rather than sitting inside the card's stacking context. */}
            {showPriceDetails && totalDays > 0 && (
                <PriceBreakdown
                    quote={quote}
                    title={`${car.year} ${car.make} ${car.model}`}
                    onClose={() => setShowPriceDetails(false)}
                />
            )}
        </div>
    )
}