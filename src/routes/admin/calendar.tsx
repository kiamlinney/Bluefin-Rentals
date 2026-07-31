import { createFileRoute } from '@tanstack/react-router'
import { CalendarGrid } from 'src/components/admin/CalendarGrid.tsx'
import { CalendarToolbar } from "@/components/admin/CalendarToolbar.tsx";
import { getConfirmedBookings, getCars, getPriceOverrides, getBlockedDates } from "@/lib/db.ts";

export const Route = createFileRoute('/admin/calendar')({
    loader: async() => {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const endDate = new Date(today)
        endDate.setDate(today.getDate() + 365)

        const startDateStr = today.toLocaleDateString('en-US')
        const endDateStr = endDate.toLocaleDateString('en-US')

        const [cars, bookings, priceOverrides, blockedDates] = await Promise.all([
            getCars(),
            getConfirmedBookings(),
            getPriceOverrides({ data: { startDate: startDateStr, endDate: endDateStr } }),
            getBlockedDates({ data: { startDate: startDateStr, endDate: endDateStr } }),
        ])
        return { cars, bookings, priceOverrides, blockedDates }
    },
    component: Calendar,
})

function Calendar() {
    const { cars, bookings, priceOverrides, blockedDates } = Route.useLoaderData()
    return (
        <div className="p-6">
            <CalendarToolbar />
            <CalendarGrid cars={cars} bookings={bookings} priceOverrides={priceOverrides} blockedDates={blockedDates} />
        </div>
  )
}
