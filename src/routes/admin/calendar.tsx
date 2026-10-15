import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CalendarGrid } from 'src/components/admin/CalendarGrid.tsx'
import { CalendarToolbar, type CalendarFilters } from "@/components/admin/CalendarToolbar.tsx";
import { DEFAULT_LISTING_FILTER } from "@/components/admin/FleetFilters.tsx";
import { SyncTuroButton } from "@/components/admin/SyncTuroButton.tsx";
import { ScheduleOverlapBanner } from "@/components/admin/ScheduleOverlapBanner.tsx";
import { TuroSwapBanner, useTuroSwapPrompt } from "@/components/admin/TuroSwapModal.tsx";
import { useScheduleFlags } from "@/components/admin/useScheduleFlags.ts";
import { getConfirmedBookings, getAdminCars, getPriceOverrides, getBlockedDates, getTuroBookings } from "@/lib/db.ts";
import { addDays, dailyPrice, todayInBusinessTz } from "@/lib/pricing.ts";
import { getPricingRules } from "@/lib/pricing-rules.ts";
import {
    DEFAULT_CAR_SORT,
    LISTING_STATUSES,
    bookedDaysAhead,
    isCarSort,
    matchesCarSearch,
    passesListingFilter,
    sortCars,
    type CarSort,
    type ListingStatus,
    type TripSpan,
} from "@/lib/fleet-view.ts";

// The toolbar's search, sort and filters live in the URL, so a refresh, the
// back button or a link from a vehicle's page ("?cars=5") lands on the same view.
// A missing `status` means the default (listed cars only); an empty one means
// every car.
type CalendarSearch = { q?: string; sort?: CarSort; status?: ListingStatus[]; cars?: number[] }

const asArray = (value: unknown): unknown[] | undefined =>
    Array.isArray(value) ? value : typeof value === 'string' || typeof value === 'number' ? String(value).split(',') : undefined

export const Route = createFileRoute('/admin/calendar')({
    validateSearch: (search: Record<string, unknown>): CalendarSearch => {
        const status = asArray(search.status)
        const cars = asArray(search.cars)
        return {
            q: typeof search.q === 'string' && search.q ? search.q : undefined,
            sort: isCarSort(search.sort) ? search.sort : undefined,
            status: status
                ? status.filter((s): s is ListingStatus => typeof s === 'string' && s in LISTING_STATUSES)
                : undefined,
            cars: cars
                ? cars.map(Number).filter(n => Number.isInteger(n) && n > 0)
                : undefined,
        }
    },
    loader: async() => {
        // 'YYYY-MM-DD' keys, which is what every date column these three
        // functions filter on is stored as. This used to send
        // toLocaleDateString('en-US') — "8/14/2026" — and relied on Postgres
        // guessing MDY, which is a DateStyle setting away from silently reading
        // the range as a different year. addDays does the arithmetic on the key
        // itself, so the window can't drift across a DST boundary either.
        const startDateStr = todayInBusinessTz()
        const endDateStr = addDays(startDateStr, 365)

        const [cars, bookings, turoBookings, priceOverrides, blockedDates, pricingRules] = await Promise.all([
            getAdminCars(),
            getConfirmedBookings(),
            getTuroBookings({ data: { startDate: startDateStr, endDate: endDateStr } }),
            getPriceOverrides({ data: { startDate: startDateStr, endDate: endDateStr } }),
            getBlockedDates({ data: { startDate: startDateStr, endDate: endDateStr } }),
            getPricingRules(),
        ])
        return { cars, bookings, turoBookings, priceOverrides, blockedDates, pricingRules }
    },
    component: Calendar,
})

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(x => b.includes(x))
const DEFAULT_STATUS: ListingStatus[] = [...DEFAULT_LISTING_FILTER]
const NO_CARS: number[] = []

function Calendar() {
    const { cars, bookings, turoBookings, priceOverrides, blockedDates, pricingRules } = Route.useLoaderData()
    const search = Route.useSearch()
    const navigate = useNavigate({ from: Route.fullPath })
    const flags = useScheduleFlags(bookings, turoBookings)
    const swapPrompt = useTuroSwapPrompt(turoBookings, cars)

    // The router hands back the same arrays until the URL changes, and the
    // fallbacks are constants, so these are stable memo dependencies.
    const filters: CalendarFilters = {
        q: search.q ?? '',
        sort: search.sort ?? DEFAULT_CAR_SORT,
        status: search.status ?? DEFAULT_STATUS,
        cars: search.cars ?? NO_CARS,
    }

    // Defaults are left out of the URL, so a plain /admin/calendar stays plain.
    const setFilters = (patch: Partial<CalendarFilters>) => {
        const next = { ...filters, ...patch }
        navigate({
            replace: true,
            search: {
                q: next.q.trim() ? next.q : undefined,
                sort: next.sort === DEFAULT_CAR_SORT ? undefined : next.sort,
                status: sameSet(next.status, DEFAULT_LISTING_FILTER) ? undefined : next.status,
                cars: next.cars.length ? next.cars : undefined,
            },
        })
    }

    // What the two data-driven sorts read: today's price (what the grid shows
    // in today's column, rules included) and booked days in the next 30.
    const sortContext = useMemo(() => {
        const today = todayInBusinessTz()
        const todaysOverride = new Map(
            priceOverrides.filter(o => o.date === today).map(o => [o.car_id, Number(o.price)]),
        )
        const todays = new Map(cars.map(car => [car.id, dailyPrice({
            date: today,
            basePricePerDay: Number(car.price_per_day),
            override: todaysOverride.get(car.id),
            rules: pricingRules,
        }).price]))
        const tripsByCar = new Map<number, TripSpan[]>()
        for (const trip of [...bookings, ...turoBookings]) {
            tripsByCar.set(trip.car_id, [...(tripsByCar.get(trip.car_id) ?? []), trip])
        }
        const booked = new Map(cars.map(car => [car.id, bookedDaysAhead(tripsByCar.get(car.id) ?? [], today)]))
        return {
            todaysPrice: (car: { id: number }) => todays.get(car.id) ?? 0,
            bookedDays: (car: { id: number }) => booked.get(car.id) ?? 0,
        }
    }, [cars, bookings, turoBookings, priceOverrides, pricingRules])

    const vehicleChoices = useMemo(
        () => cars.filter(car => passesListingFilter(car, filters.status)),
        [cars, filters.status],
    )

    const shownCars = useMemo(() => {
        const picked = filters.cars.length
            ? vehicleChoices.filter(car => filters.cars.includes(car.id))
            : vehicleChoices
        return sortCars(picked.filter(car => matchesCarSearch(car, filters.q)), filters.sort, sortContext)
    }, [vehicleChoices, filters.cars, filters.q, filters.sort, sortContext])

    return (
        // Full-height column so the grid can take whatever the toolbar leaves and
        // scroll both ways inside itself, keeping its sticky header/car column in view
        <div className="p-3 md:p-6 h-full flex flex-col">
            <CalendarToolbar
                filters={filters}
                onChange={setFilters}
                vehicleChoices={vehicleChoices}
                actions={<SyncTuroButton />}
            />
            <TuroSwapBanner pending={flags.pendingSwaps} cars={cars} onOpen={swapPrompt.open} />
            <ScheduleOverlapBanner overlaps={flags.overlaps} refs={flags.refs} cars={cars} />
            {shownCars.length === 0 && (
                <p className="mb-3 text-sm text-gray-600">
                    No vehicles match these filters.{' '}
                    <button
                        type="button"
                        className="font-medium text-gray-900 underline cursor-pointer"
                        onClick={() => navigate({ replace: true, search: {} })}
                    >
                        Clear filters
                    </button>
                </p>
            )}
            <CalendarGrid
                cars={shownCars}
                bookings={bookings}
                turoBookings={turoBookings}
                priceOverrides={priceOverrides}
                blockedDates={blockedDates}
                overlapNotes={flags.overlapNotes}
                onTuroSwapClick={swapPrompt.open}
                pricingRules={pricingRules}
            />
            {swapPrompt.modal}
        </div>
  )
}
