import { createFileRoute } from '@tanstack/react-router'
import { CalendarGrid } from 'src/components/admin/CalendarGrid.tsx'
import { CalendarToolbar } from "@/components/admin/CalendarToolbar.tsx";
import { getConfirmedBookings, getCars, getPriceOverrides, getBlockedDates, getTuroBookings } from "@/lib/db.ts";
import { addDays, todayInBusinessTz } from "@/lib/pricing.ts";

export const Route = createFileRoute('/admin/calendar')({
    loader: async() => {
        // 'YYYY-MM-DD' keys, which is what every date column these three
        // functions filter on is stored as. This used to send
        // toLocaleDateString('en-US') — "8/14/2026" — and relied on Postgres
        // guessing MDY, which is a DateStyle setting away from silently reading
        // the range as a different year. addDays does the arithmetic on the key
        // itself, so the window can't drift across a DST boundary either.
        const startDateStr = todayInBusinessTz()
        const endDateStr = addDays(startDateStr, 365)

        const [cars, bookings, turoBookings, priceOverrides, blockedDates ] = await Promise.all([
            getCars(),
            getConfirmedBookings(),
            getTuroBookings({ data: { startDate: startDateStr, endDate: endDateStr } }),
            getPriceOverrides({ data: { startDate: startDateStr, endDate: endDateStr } }),
            getBlockedDates({ data: { startDate: startDateStr, endDate: endDateStr } }),
        ])
        return { cars, bookings, turoBookings, priceOverrides, blockedDates }
    },
    component: Calendar,
})

function Calendar() {
    const { cars, bookings, turoBookings, priceOverrides, blockedDates } = Route.useLoaderData()
    return (
        <div className="p-6">
            <CalendarToolbar />
            <CalendarGrid cars={cars} bookings={bookings} turoBookings={turoBookings} priceOverrides={priceOverrides} blockedDates={blockedDates} />
        </div>
  )
}
