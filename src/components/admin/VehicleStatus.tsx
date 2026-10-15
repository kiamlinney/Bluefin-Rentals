import { listingStatusOf, VEHICLE_TRIP_STATUS_LABEL } from '@/lib/fleet-view'
import { formatBusinessDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { VehicleStatusLine } from '@/lib/vehicles'

// Shared by the Vehicles list and a vehicle's own page.

export function ListingBadge({ isAvailable, className }: { isAvailable: boolean | null; className?: string }) {
    const listed = listingStatusOf({ is_available: isAvailable }) === 'listed'
    return (
        <span
            className={cn(
                'rounded px-2 py-0.5 text-xs font-semibold text-white',
                listed ? 'bg-emerald-700' : 'bg-red-600',
                className,
            )}
        >
            {listed ? 'Listed' : 'Unlisted'}
        </span>
    )
}

const SHORT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

/** "On a trip: Oct 8 – Oct 13", "Next trip: …", "Last trip: …", "No trips yet". */
export function vehicleStatusText(status: VehicleStatusLine): string {
    if (status.kind === 'none') return VEHICLE_TRIP_STATUS_LABEL.none
    const range = `${formatBusinessDate(status.start, SHORT)} – ${formatBusinessDate(status.end, SHORT)}`
    return `${VEHICLE_TRIP_STATUS_LABEL[status.kind]}: ${range}${status.source === 'turo' ? ' (Turo)' : ''}`
}
