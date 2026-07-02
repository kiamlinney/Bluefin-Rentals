import { createFileRoute } from '@tanstack/react-router'
import { CalendarGrid } from 'src/components/admin/CalendarGrid.tsx'
import { getConfirmedBookings, getCars } from "@/lib/db.ts";
import { CalendarToolbar } from "@/components/admin/CalendarToolbar.tsx";

export const Route = createFileRoute('/admin/calendar')({
    loader: async() => {
        const [cars, bookings] = await Promise.all([
            getCars(),
            getConfirmedBookings(),
        ])
        return { cars, bookings }
    },
    component: Calendar,
})

function Calendar() {
    const { cars, bookings } = Route.useLoaderData()
    return (
        <div className="p-6">
            <CalendarToolbar />
            <CalendarGrid cars={cars} bookings={bookings} />
        </div>
  )
}
