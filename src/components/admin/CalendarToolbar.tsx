import type { ReactNode } from "react";
import { FleetSearchField, ListingStatusFilter, SortFilter, VehicleFilter } from "@/components/admin/FleetFilters.tsx";
import type { CarSort, FleetCar, ListingStatus } from "@/lib/fleet-view.ts";

export type CalendarFilters = {
    q: string
    sort: CarSort
    status: ListingStatus[]
    cars: number[]
}

export function CalendarToolbar({
    filters,
    onChange,
    vehicleChoices,
    actions,
}: {
    filters: CalendarFilters
    onChange: (patch: Partial<CalendarFilters>) => void
    /** The cars the Vehicle filter offers: the ones the listing filter allows. */
    vehicleChoices: readonly FleetCar[]
    actions?: ReactNode
}) {
    return (
        <div className="flex flex-wrap items-start gap-2 md:gap-3 mb-3 md:mb-4">
            {/* Search field - full row on phones, the buttons wrap beneath it */}
            <FleetSearchField value={filters.q} onChange={q => onChange({ q })} className="w-full sm:w-72" />
            <SortFilter value={filters.sort} onChange={sort => onChange({ sort })} />
            <ListingStatusFilter value={filters.status} onChange={status => onChange({ status })} />
            <VehicleFilter cars={vehicleChoices} value={filters.cars} onChange={cars => onChange({ cars })} />

            {/* Page actions, pushed to the right edge */}
            {actions && <div className="sm:ml-auto">{actions}</div>}
        </div>
    )
}
