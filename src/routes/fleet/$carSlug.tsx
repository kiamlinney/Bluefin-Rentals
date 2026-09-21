import {createFileRoute, Link, notFound, redirect, useNavigate} from "@tanstack/react-router"
import { getCarById } from "@/lib/db.ts";
import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { z } from "zod";
import { Users, Fuel, Gauge, ThumbsUp, Settings2, X, ChevronDown } from "lucide-react";
import { getBookedDates, getCarPriceOverrides, getReviews } from "@/lib/db.ts";
import { summarizeRatings } from "@/lib/reviews.ts";
import { RatingSummary } from "@/components/reviews/RatingSummary.tsx";
import { ReviewList } from "@/components/reviews/ReviewList.tsx";
import { getUser } from "@/lib/auth.ts";
import { carImageUrl, carMainImageUrl, carPhotoUrl } from "@/lib/car-images.ts";
import {
    addDays,
    buildOverrideMap,
    calculateTripPrice,
    dateKeyToLocalDate,
    getTripDurationMinutes,
    timeToMinutes,
    toDateKey,
    todayInBusinessTz,
    type PriceOverrides,
} from "@/lib/pricing.ts";
import { formatDateKey, formatMinutesOfDay } from "@/lib/dates.ts";
import {
    BUSINESS_CLOSE_MINUTES,
    BUSINESS_OPEN_MINUTES,
    MIN_LEAD_TIME_HOURS,
    SLOT_MINUTES,
    buildAvailabilityMap,
    dayWindow,
    earliestStartMinutesFor,
    earliestStartMinutesToday,
    findTripConflict,
    latestEndMinutesFor,
    toOccupiedSpans,
    type AvailabilityMap,
    type DateSpan,
    type TripConflict,
} from "@/lib/availability.ts";
import { TripCalendar } from "@/components/TripCalendar.tsx";
import { PriceBreakdown } from "@/components/PriceBreakdown.tsx";
import { PickupLocationPicker } from "@/components/PickupLocationPicker.tsx";
import { DEFAULT_PICKUP, resolvePickup, type PickupSelection } from "@/lib/pickup.ts";
import { DEFAULT_BOOKING_RATE } from "@/lib/booking-rate.ts";
import {
    MILES_INCLUDED_PER_DAY,
    distanceFeeForTrip,
    formatMiles,
    maxDistanceFee,
    milesIncluded,
} from "@/lib/distance.ts";
import { carSlug, parseCarIdFromSlug } from "@/lib/slug.ts";
import { absoluteUrl } from "@/lib/site.ts";
import { DEFAULT_OG_IMAGE } from "@/lib/business.ts";

// Optional because most visitors arrive without dates. `.catch(undefined)` so a
// hand-mangled URL renders an empty picker instead of an error boundary.
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const carSearchSchema = z.object({
    start: z.string().regex(DATE_KEY).optional().catch(undefined),
    end: z.string().regex(DATE_KEY).optional().catch(undefined),
})

export const Route = createFileRoute("/fleet/$carSlug")({
    validateSearch: carSearchSchema,
    loader: async ({ params }) => {
        const carId = parseCarIdFromSlug(params.carSlug)
        if (!carId) throw notFound()

        const car = await getCarById({ data: carId })

        // One car, one indexable URL. A bare id or a stale name still resolves,
        // then permanently redirects to the current spelling.
        const canonical = carSlug(car)
        if (params.carSlug !== canonical) {
            throw redirect({
                to: "/fleet/$carSlug",
                params: { carSlug: canonical },
                search: (prev) => prev,
                statusCode: 301,
            })
        }

        const [user, reviews] = await Promise.all([
            getUser().catch(() => null),
            getReviews({ data: { carId: car.id } }),
        ])
        return { car, user, reviews }
    },

    // Meta tag generation to optimize SEO
    head: ({ loaderData }) => ({
        links: loaderData
            ? [{ rel: "canonical", href: absoluteUrl(`/fleet/${carSlug(loaderData.car)}`) }]
            : [],
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
            { property: "og:image", content: loaderData ? carMainImageUrl(loaderData.car.id) : DEFAULT_OG_IMAGE },
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
                className="w-full flex items-center justify-between border border-line rounded-lg px-4 py-3 text-sm hover:border-ink-400 transition-colors cursor-pointer"
            >
                <span>{selected?.label ?? value}</span>
                <ChevronDown size={14} className={`text-muted transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <div
                    ref={scrollRef}
                    className="absolute top-full left-0 right-0 mt-1 z-[120] bg-surface border border-line rounded-lg shadow-lg max-h-96 overflow-y-scroll time-dropdown-scroll"
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
                                    ? "text-ink-400 cursor-not-allowed"
                                    : opt.value === value
                                        ? "bg-subtle font-semibold cursor-pointer"
                                        : "hover:bg-subtle cursor-pointer"
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

// Every conflict names the fix, not just the problem. "Unavailable" sends a
// customer looking for another car; "the earliest you can start is 1:00 PM"
// sends them to the dropdown three inches away.
const conflictMessage = (conflict: TripConflict): string => {
    switch (conflict.kind) {
        case "lead-time":
            return conflict.earliestStart === null
                ? `Trips must start at least ${MIN_LEAD_TIME_HOURS} hours from now, so today is fully booked. Please choose a later date.`
                : `Trips must start at least ${MIN_LEAD_TIME_HOURS} hours from now. The earliest start today is ${formatMinutesOfDay(conflict.earliestStart)}.`;
        case "start-too-early":
            return `This car is returning from another trip on ${formatDayKey(conflict.dateKey)}. The earliest you can start that day is ${formatMinutesOfDay(conflict.earliestStart)}.`;
        case "end-too-late":
            return `Another trip starts on ${formatDayKey(conflict.dateKey)}, so this car must be back by ${formatMinutesOfDay(conflict.latestEnd)} that day.`;
        case "days-unavailable":
            return unavailableMessage(conflict.dateKeys);
    }
};

// Pinned locale: with dates prefilled from the URL these labels now render on
// the server too, and Node's default locale needn't match the browser's.
const formatTriggerDate = (d: Date) => d.toLocaleDateString("en-US");

function CarDetails() {
    const { car, user, reviews } = Route.useLoaderData()
    const reviewSummary = useMemo(() => summarizeRatings(reviews.map((r) => r.rating)), [reviews])
    // The rest of the page works in ids; the slug is only ever a URL concern.
    const carId = String(car.id)
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

    // Per-day free windows rather than a list of dead days — see
    // src/lib/availability.ts. This is what lets a trip start at 1pm on a day
    // another trip returned at 10am.
    const [availability, setAvailability] = useState<AvailabilityMap>(() => new Map());
    const [availabilityLoaded, setAvailabilityLoaded] = useState(false);

    // The 3-hour lead time is measured against a moving target, so `now` can't
    // be read once at render. Without this tick a widget left open on a phone
    // crosses the cutoff and keeps offering a slot the server will reject.
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(id);
    }, []);
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

    // Business hours now come from src/lib/availability.ts, which is also where
    // the "earliest start today" math reads them — the two can't disagree about
    // when 10:30pm is, which matters because one greys out slots and the other
    // decides whether today is bookable at all.
    const baseTimeOptions = useMemo(() => {
        return Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, i) => {
            const totalMinutes = i * SLOT_MINUTES; // starts at midnight (0 min)
            const hour = Math.floor(totalMinutes / 60);
            const min = totalMinutes % 60;
            const minStr = min === 0 ? "00" : "30";
            const period = hour >= 12 ? "PM" : "AM";
            const displayHour = hour % 12 === 0 ? 12 : hour % 12;

            const outOfHours =
                totalMinutes < BUSINESS_OPEN_MINUTES || totalMinutes > BUSINESS_CLOSE_MINUTES;

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

    // The earliest a trip may begin on the chosen start day, and the latest it
    // may end on the chosen end day. Both fold together everything that
    // constrains that day: the turnaround buffer around neighbouring trips, and
    // — for today only — the 3-hour lead time.
    const earliestStart = useMemo(() => {
        if (!startDate) return BUSINESS_OPEN_MINUTES;
        return dayWindow(availability, toDateKey(startDate)).earliestStart;
    }, [startDate, availability]);

    const latestEnd = useMemo(() => {
        if (!endDate) return BUSINESS_CLOSE_MINUTES;
        return dayWindow(availability, toDateKey(endDate)).latestEnd;
    }, [endDate, availability]);

    // Null once the lead time pushes past closing, i.e. today is spent.
    const leadTimeFloor = useMemo(
        () => (startDate && toDateKey(startDate) === todayInBusinessTz(now)
            ? earliestStartMinutesToday(now)
            : null),
        [startDate, now],
    );

    // Start options: on same-day trips disable slots >= endTime; always disable
    // anything before the day's earliest start or before the lead-time floor.
    const startTimeOptions = useMemo(() => {
        const endMinutes = timeToMinutes(endTime);
        const floor = Math.max(earliestStart, leadTimeFloor ?? 0);
        const todayIsSpent = startDate != null
            && toDateKey(startDate) === todayInBusinessTz(now)
            && leadTimeFloor === null;

        return baseTimeOptions.map(t => {
            const minutes = timeToMinutes(t.value);
            return {
                ...t,
                disabled:
                    t.disabled
                    || todayIsSpent
                    || minutes < floor
                    || (isSameDay && minutes >= endMinutes),
            };
        });
    }, [isSameDay, endTime, baseTimeOptions, earliestStart, leadTimeFloor, startDate, now]);

    // End options: on same-day trips disable slots <= startTime; always disable
    // anything after the day's latest end.
    const endTimeOptions = useMemo(() => {
        const startMinutes = timeToMinutes(startTime);
        return baseTimeOptions.map(t => {
            const minutes = timeToMinutes(t.value);
            return {
                ...t,
                disabled:
                    t.disabled
                    || minutes > latestEnd
                    || (isSameDay && minutes <= startMinutes),
            };
        });
    }, [isSameDay, startTime, baseTimeOptions, latestEnd]);

    // Picking a day whose first free slot is 1:00 PM leaves startTime sitting on
    // its "10:00" default — a value the dropdown now renders as disabled and the
    // server would reject. Snap to the first slot that is actually offered.
    //
    // Guarded on availabilityLoaded so the empty initial map doesn't count as
    // "everything is free" and overwrite a time the customer just chose.
    useEffect(() => {
        if (!availabilityLoaded) return;
        const current = startTimeOptions.find(o => o.value === startTime);
        if (current && !current.disabled) return;
        const firstFree = startTimeOptions.find(o => !o.disabled);
        if (firstFree) setStartTime(firstFree.value);
    }, [availabilityLoaded, startTimeOptions, startTime]);

    useEffect(() => {
        if (!availabilityLoaded) return;
        const current = endTimeOptions.find(o => o.value === endTime);
        if (current && !current.disabled) return;
        // Last rather than first: an end time wants to be as late as the day
        // allows, which is also what the "22:00" default was reaching for.
        const lastFree = [...endTimeOptions].reverse().find(o => !o.disabled);
        if (lastFree) setEndTime(lastFree.value);
    }, [availabilityLoaded, endTimeOptions, endTime]);

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

    // Falls as the trip lengthens, because it's derived from the trip's average
    // daily price — see src/lib/distance.ts. With no dates picked this is the
    // car's stored ceiling, which is what the undated copy below quotes.
    const distanceFee = useMemo(
        () => distanceFeeForTrip(car, quote, Number(car.price_per_day)),
        [car, quote],
    );

    // Which days can't host a start, and which can't host an end
    const unselectableStartDays = useMemo<DateSpan[]>(() => {
        const spans: DateSpan[] = [];
        for (const key of availability.keys()) {
            if (earliestStartMinutesFor(key, availability, now) !== null) continue;
            const date = dateKeyToLocalDate(key);
            if (date) spans.push({ from: date, to: date });
        }
        return spans;
    }, [availability, now]);

    const unselectableEndDays = useMemo<DateSpan[]>(() => {
        const spans: DateSpan[] = [];
        for (const key of availability.keys()) {
            if (latestEndMinutesFor(key, availability) !== null) continue;
            const date = dateKeyToLocalDate(key);
            if (date) spans.push({ from: date, to: date });
        }
        return spans;
    }, [availability]);

    // The floor for the start calendar. Passing this explicitly also pins the
    // floor to the business day: TripCalendar's own default is the *browser's*
    // local midnight, which is a different day for a customer in Hawaii.
    const earliestSelectableDay = useMemo(() => {
        const todayKey = todayInBusinessTz(now);
        const key = earliestStartMinutesToday(now) === null ? addDays(todayKey, 1) : todayKey;
        return dateKeyToLocalDate(key) ?? undefined;
    }, [now]);

    // Both pickers already refuse a booked day as an *endpoint*, but nothing
    // stopped a start before a booked block and an end after it — the whole
    // block sat inside the range and the trip only failed at the Stripe payment
    // step, after driver info and identity verification.
    const conflict = useMemo(() => {
        if (!startDate || !endDate) return null;
        return findTripConflict(
            toDateKey(startDate), startTime, toDateKey(endDate), endTime, availability, now,
        );
    }, [startDate, endDate, startTime, endTime, availability, now]);

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
        if (conflict) return conflictMessage(conflict);
        return null;
    }, [startDate, endDate, totalDurationDays, conflict, resolvedPickup]);

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

            // The clock times survive this time. They used to be collapsed to
            // whole days here, which is what made same-day handoff impossible —
            // nothing downstream could know a trip returned at 10am. Everything
            // that decides *which* day a time belongs to happens in business
            // time inside toOccupiedSpans, not in the visitor's zone.
            setAvailability(buildAvailabilityMap(toOccupiedSpans(bookings)));
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
                // Seeded, not chosen: the rate is picked on the checkout page.
                // `subtotal` above is the anchor-rate total, so the two agree.
                bookingRate: DEFAULT_BOOKING_RATE,
            }
        })
    }
    
    const getImageUrl = (fileName: string) => carImageUrl(carId, fileName)

    const images = car.gallery_images || [];
    const PREFERRED_ORDER = ["Safety", "Device connectivity", "Convenience", "Additional features"];

  
    const features = (car.features ?? {}) as Record<string, unknown>;

    if (showGallery) {
        return (
            <div className="fixed inset-0 z-[100] overflow-y-auto bg-page">
                <div className="sticky top-0 backdrop-blur-lg py-4 px-8 flex justify-between items-center border-b-[0.5px] z-50">
                    <h2 className="text-xl font-bold">{car.make} {car.model} {car.year}</h2>
                    <button
                        onClick={() => setShowGallery(false)}
                        className="p-2 hover:bg-subtle rounded-full transition-colors cursor-pointer"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 max-w-8xl mx-auto p-4 flex-col gap-8 mt-4">
                    {images.map((img: string, index: number) => (
                        <div key={index} className="w-full rounded-xl overflow-hidden bg-subtle shadow-sm">
                            <img
                                src={getImageUrl(img)}
                                className="w-full h-full object-cover aspect-video"
                                alt={`${car.year} ${car.make} ${car.model} - gallery image ${index + 1}`}
                                loading={index < 2 ? "eager" : "lazy"}
                                decoding="async"
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
                <div className="flex flex-wrap gap-4 mt-6">
                    <div className="flex items-center gap-2 bg-subtle px-4 py-2 rounded-lg text-sm">
                        <Users size={18} /> {car.num_seats} seats
                    </div>
                    <div className="flex items-center gap-2 bg-subtle px-4 py-2 rounded-lg text-sm">
                        <Fuel size={18} /> {car.fuel_type}
                    </div>
                    <div className="flex items-center gap-2 bg-subtle px-4 py-2 rounded-lg text-sm">
                        <Gauge size={18} /> {car.mpg} MPG
                    </div>
                    <div className="flex items-center gap-2 bg-subtle px-4 py-2 rounded-lg text-sm">
                        <Settings2 size={18} /> {car.transmission} transmission
                    </div>
                </div>

                <div className="mt-6 grid grid-cols-1 lg:grid-cols-4 gap-2 rounded-lg overflow-hidden group cursor-pointer"
                     onClick={() => setShowGallery(true)}>

                    {/* Main image */}
                    <div className="lg:col-span-2 lg:row-span-2 relative h-[400px]" >
                        <img
                            src={carMainImageUrl(carId)}



                            className="w-full h-full object-cover"
                            alt={`${car.year} ${car.make} ${car.model} rental - main view`}
                            fetchPriority="high"
                            decoding="async"
                        />
                    </div>

                    {/* Top Left Image */}
                    <div className="hidden lg:block h-[196px] border border-line">
                        <img
                            src={carPhotoUrl(carId, "top_left")}
                            className="w-full h-full object-cover"
                            alt={`${car.year} ${car.make} ${car.model} rental - front interior view`}
                            decoding="async"
                            // These four are `hidden lg:block`. Without lazy the
                            // browser fetches them on phones too, where they never
                            // render — 280-600KB a visit. Lazy skips them below the
                            // breakpoint and still loads them on desktop, where they
                            // sit in the opening viewport.
                            loading="lazy"
                        />
                    </div>

                    {/* Top Right Image */}
                    <div className="hidden lg:block h-[196px] border border-line">
                        <img
                            src={carPhotoUrl(carId, "top_right")}
                            className="w-full h-full object-cover"
                            alt={`${car.year} ${car.make} ${car.model} rental - back view`}
                            decoding="async"
                            loading="lazy"
                        />
                    </div>

                    {/* Bottom Left Image */}
                    <div className="hidden lg:block h-[196px] border border-line">
                        <img
                            src={carPhotoUrl(carId, "bottom_left")}
                            className="w-full h-full object-cover"
                            alt={`${car.year} ${car.make} ${car.model} rental - front view`}
                            decoding="async"
                            loading="lazy"
                        />
                    </div>

                    {/* Bottom Right Image */}
                    <div className="hidden lg:block h-[196px] relative group border border-line">
                        <img
                            src={carPhotoUrl(carId, "bottom_right")}
                            className="w-full h-full object-cover"
                            alt={`${car.year} ${car.make} ${car.model} rental - back interior view`}
                            decoding="async"
                            loading="lazy"
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
                                                <li key={feature} className="text-muted font-medium">
                                                    {feature}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                );
                            })}
                        </div>

                        {/*<h2 className="text-2xl font-bold mt-6">Convenience</h2>*/}
                        {/*<h2 className="text-2xl font-bold mt-6">Peace of mind</h2>*/}
                        {/*<h2 className="text-2xl font-bold mt-6">Road rules</h2>*/}

                        <hr className="my-6" />

                        <h2 className="text-3xl font-bold mt-6">
                            Ratings and reviews
                        </h2>

                        {reviews.length > 0 ? (
                            <div className="mt-6 space-y-10">
                                <RatingSummary
                                    summary={reviewSummary}
                                    includesTuro={reviews.some((r) => r.source === 'turo')}
                                />
                                <ReviewList reviews={reviews} />
                            </div>
                        ) : (
                            <p className="mt-4 text-muted">No reviews for this car yet.</p>
                        )}

                        <Link
                            to="/reviews"
                            className="inline-block mt-6 text-sm font-semibold text-ink underline"
                        >
                            See reviews across our whole fleet
                        </Link>

                    </div>

                    {/* -------------------------------- Booking Widget --------------------------------  */}
                    <div className="w-full lg:w-[400px] flex flex-col gap-8 lg:self-start">
                        {user ? (
                            <div className="top-24 z-10 rounded-xl border border-line bg-surface shadow-xl">
                                <div className="p-6 relative">
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-2xl font-bold">${car.price_per_day}</span>
                                        <span className="text-muted font-medium mb-4">/ day</span>
                                    </div>

                                    <hr className="border-line" />

                                    {totalDays > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setShowPriceDetails(true)}
                                            className="mt-4 w-full p-3 bg-subtle rounded-lg flex justify-between items-center font-bold border border-line hover:bg-cream-200 transition-colors cursor-pointer"
                                        >
                                            <span className="flex items-center gap-1.5">
                                                {totalDays} day trip
                                                <ChevronDown size={14} className="text-muted" />
                                            </span>
                                            <span className="flex items-baseline gap-2">
                                                {/* Show what the trip would have cost without the
                                                    duration discounts, so the saving is visible. */}
                                                {quote.discountAmount + quote.extraDiscountAmount > 0 && (
                                                    <span className="text-muted font-medium line-through">
                                                        ${quote.subtotal.toFixed(2)}
                                                    </span>
                                                )}
                                                ${subtotal.toFixed(2)} total
                                            </span>
                                        </button>
                                    )}

                                    <p className="text-muted text-sm font-medium mb-6 mt-2">
                                        {totalDays > 0 && "Click for price details"}
                                    </p>

                                    <div className="space-y-4 mb-6">

                                        {/* Trip start row */}
                                        <div className="relative">

                                            <label className="block text-sm mb-1.5">Trip start</label>

                                            <div className="flex gap-3">
                                                <button
                                                    ref={startTriggerRef}
                                                    onClick={toggleStartCalendar}
                                                    className="flex-[1.3] flex items-center justify-between border border-line rounded-lg px-4 py-3 text-sm hover:border-ink-400 transition-colors cursor-pointer"
                                                >
                                                    <span>{startDate ? formatTriggerDate(startDate) : "Select Date"}</span>
                                                    <ChevronDown size={14} className="text-muted" />
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
                                                    unavailableRanges={unselectableStartDays}
                                                    minDate={earliestSelectableDay}
                                                />
                                        </div>


                                        {/* Trip end row */}
                                        <div className="relative">

                                            <label className="block text-sm mb-1.5">Trip end</label>

                                            <div className="flex gap-3">
                                                <button
                                                    ref={endTriggerRef}
                                                    onClick={toggleEndCalendar}
                                                    className="flex-[1.3] flex items-center justify-between border border-line rounded-lg px-4 py-3 text-sm hover:border-ink-400 transition-colors cursor-pointer"
                                                >
                                                    <span>{endDate ? formatTriggerDate(endDate) : "Select Date"}</span>
                                                    <ChevronDown size={14} className="text-muted" />
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
                                                    unavailableRanges={unselectableEndDays}
                                                    minDate={earliestSelectableDay}
                                                />
                                        </div>

                                        <hr className="border-line" />

                                        <PickupLocationPicker
                                            value={pickup}
                                            onChange={setPickup}
                                        />

                                        <hr className="border-line" />

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
                                            "bg-brand text-on-brand rounded-lg w-full text-lg py-6 shadow-lg transition-all hover:bg-pine-800",
                                            isButtonDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                                        ].join(" ")}
                                    >
                                        Continue
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="top-24 z-10 rounded-xl border border-line bg-surface shadow-xl">
                                <div className="p-6 text-center space-y-4">
                                    <p className="font-semibold text-lg">
                                        {/*TODO: change this to after selecting dates, in checkout*/}
                                        Please login to book a vehicle
                                    </p>
                                    <p className="text-muted text-sm">
                                        Create an account or login to continue.
                                    </p>
                                    <Link
                                        to="/login"
                                        // Carry the dates through the round trip: the booking widget
                                        // only renders when logged in, so without this a customer who
                                        // arrives from the search bar comes back to empty calendars.
                                        search={{
                                            redirect: search.start && search.end
                                                ? `/fleet/${carSlug(car)}?start=${search.start}&end=${search.end}`
                                                : `/fleet/${carSlug(car)}`,
                                        }}
                                        className="block w-full py-3 bg-brand shadow-lg text-on-brand rounded-full font-medium hover:bg-pine-800 hover:scale-101 transition-colors"
                                    >
                                        Login or Sign Up
                                    </Link>
                                </div>
                            </div>
                        )}


                        <div className="mt-4 space-y-4 relative">
                            <div className="space-y-3">
                                <p className="text-lg font-bold">Cancellation policy</p>
                                <div className="flex items-start gap-3">
                                    <ThumbsUp size={22} className="flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-base">
                                            Free cancellation
                                        </p>

                                        <p className="text-sm text-muted mt-0.5">
                                            Full refund within 24 hours of booking. More flexible options available at checkout.
                                            View the full policy {' '}
                                            <Link
                                                to="/policies/cancellation"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="underline cursor-pointer hover:text-gray-700"
                                            >
                                               here
                                            </Link>

                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Sits outside the `user ?` branch above, so a
                                logged-out visitor sees it too */}
                            <div className="space-y-3">
                                <p className="text-lg font-bold">Distance included</p>
                                <div className="flex items-start gap-3">
                                    <Gauge size={22} className="flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-base">
                                            {totalDays > 0
                                                ? `${formatMiles(milesIncluded(totalDays))} mi`
                                                : `${MILES_INCLUDED_PER_DAY} miles / day`}
                                        </p>
                                        {/* "from" only while undated: the rate
                                            can still drop once a range is
                                            picked, never rise. */}
                                        <p className="text-sm text-muted mt-0.5">
                                            {totalDays > 0
                                                ? `$${distanceFee.toFixed(2)}/mi fee for additional miles driven`
                                                : `from $${maxDistanceFee(car).toFixed(2)}/mi for additional miles driven`}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/*TODO: Complete insurance information*/}
                            {/*<p className="text-lg font-bold">Insurance & protection</p>*/}
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