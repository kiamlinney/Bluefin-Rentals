import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { LayoutGrid, List, SlidersHorizontal, Star } from 'lucide-react'
import { listVehicles, type VehicleListRow, type VehicleStatusLine } from '@/lib/vehicles'
import type { ReactNode } from 'react'
import { CheckboxFilter, FleetSearchField, ListingStatusFilter } from '@/components/admin/FleetFilters'
import { ListingBadge, vehicleStatusText } from '@/components/admin/VehicleStatus'
import {
    LISTING_STATUSES,
    compareCarNames,
    matchesCarSearch,
    passesListingFilter,
    type FleetCar,
    type ListingStatus,
} from '@/lib/fleet-view'
import { carMainImageUrl } from '@/lib/car-images'
import { formatAverage } from '@/lib/reviews'
import { cn } from '@/lib/utils'

// Every car in the fleet, listed or not, Turo-style: a card per car with what
// it's doing right now. The filters and the grid/list choice live in the URL,
// so coming back from a car keeps them.

const TRIP_FILTERS = {
    'on-trip': 'On a trip',
    upcoming: 'Upcoming trip',
    idle: 'No upcoming trips',
} as const
type TripFilter = keyof typeof TRIP_FILTERS

type VehiclesSearch = { q?: string; trip?: TripFilter[]; status?: ListingStatus[]; view?: 'list' }

const asArray = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : typeof value === 'string' && value ? value.split(',') : []

export const Route = createFileRoute('/admin/vehicles/')({
    validateSearch: (search: Record<string, unknown>): VehiclesSearch => {
        const trip = asArray(search.trip).filter((t): t is TripFilter => typeof t === 'string' && t in TRIP_FILTERS)
        const status = asArray(search.status).filter((s): s is ListingStatus => typeof s === 'string' && s in LISTING_STATUSES)
        return {
            q: typeof search.q === 'string' && search.q ? search.q : undefined,
            trip: trip.length ? trip : undefined,
            status: status.length ? status : undefined,
            view: search.view === 'list' ? 'list' : undefined,
        }
    },
    loader: () => listVehicles(),
    component: VehiclesPage,
})

const NONE: never[] = []

function tripFilterOf(status: VehicleStatusLine): TripFilter {
    return status.kind === 'on-trip' ? 'on-trip' : status.kind === 'next' ? 'upcoming' : 'idle'
}

const asFleetCar = (v: VehicleListRow): FleetCar => ({
    id: v.id, make: v.make, model: v.model, year: v.year, trim: v.trim, license_plate: v.licensePlate, is_available: v.isAvailable,
})

function VehiclesPage() {
    const vehicles = Route.useLoaderData()
    const search = Route.useSearch()
    const navigate = useNavigate({ from: Route.fullPath })

    const q = search.q ?? ''
    const trip = search.trip ?? NONE
    const status = search.status ?? NONE
    const setSearch = (patch: Partial<VehiclesSearch>) =>
        navigate({ replace: true, search: prev => ({ ...prev, ...patch }) })

    const shown = useMemo(
        () =>
            vehicles
                .filter(v => matchesCarSearch(asFleetCar(v), q))
                .filter(v => passesListingFilter(asFleetCar(v), status))
                .filter(v => trip.length === 0 || trip.includes(tripFilterOf(v.status)))
                .sort((a, b) => compareCarNames(asFleetCar(a), asFleetCar(b))),
        [vehicles, q, trip, status],
    )

    return (
        <div className="p-3 md:p-6">
            <div className="mx-auto max-w-6xl">
                <div className="flex flex-wrap items-start gap-2 md:gap-3">
                    <FleetSearchField
                        value={q}
                        onChange={value => setSearch({ q: value.trim() ? value : undefined })}
                        className="w-full sm:w-80"
                    />
                    <CheckboxFilter
                        label="Trip status"
                        options={TRIP_FILTERS}
                        value={trip}
                        defaultValue={NONE}
                        onChange={next => setSearch({ trip: next.length ? next : undefined })}
                    />
                    <ListingStatusFilter
                        value={status}
                        defaultValue={NONE}
                        onChange={next => setSearch({ status: next.length ? next : undefined })}
                    />
                    <Link
                        to="/admin/pricing"
                        className="sm:ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                        <SlidersHorizontal size={14} aria-hidden /> Pricing rules
                    </Link>
                </div>

                <div className="mt-6 mb-4 flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-black">
                        {shown.length} {shown.length === 1 ? 'Vehicle' : 'Vehicles'}
                    </h1>
                    <div className="flex gap-1" role="group" aria-label="View">
                        <ViewButton active={search.view !== 'list'} label="Grid" onClick={() => setSearch({ view: undefined })}>
                            <LayoutGrid size={16} />
                        </ViewButton>
                        <ViewButton active={search.view === 'list'} label="List" onClick={() => setSearch({ view: 'list' })}>
                            <List size={16} />
                        </ViewButton>
                    </div>
                </div>

                {shown.length === 0 ? (
                    <p className="text-sm text-gray-600">
                        No vehicles match.{' '}
                        <button type="button" className="font-medium text-gray-900 underline cursor-pointer" onClick={() => navigate({ replace: true, search: {} })}>
                            Clear filters
                        </button>
                    </p>
                ) : search.view === 'list' ? (
                    <VehicleTable vehicles={shown} />
                ) : (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                        {shown.map(v => <VehicleCard key={v.id} vehicle={v} />)}
                    </div>
                )}
            </div>
        </div>
    )
}

function ViewButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg border cursor-pointer',
                active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
            )}
        >
            {children}
        </button>
    )
}

// "4.9 ★ (6 trips)", or just "6 trips" before any review. The count is Turo and
// Bluefin together once a car's Turo count is entered (fleet-view.ts#tripCount).
function RatingLine({ vehicle }: { vehicle: VehicleListRow }) {
    const trips = `${vehicle.tripCount} ${vehicle.tripCount === 1 ? 'trip' : 'trips'}`
    if (vehicle.reviewCount === 0) {
        return <span className="shrink-0 whitespace-nowrap text-gray-600">{trips}</span>
    }
    return (
        <span
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
            title={`${vehicle.reviewCount} ${vehicle.reviewCount === 1 ? 'review' : 'reviews'}`}
        >
            {formatAverage(vehicle.rating)}
            <Star size={14} className="fill-gray-900 text-gray-900" aria-label="stars" />
            <span className="text-gray-600">({trips})</span>
        </span>
    )
}

function VehicleCard({ vehicle: v }: { vehicle: VehicleListRow }) {
    return (
        <Link
            to="/admin/vehicles/$carId"
            params={{ carId: String(v.id) }}
            className="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
        >
            <div className="relative aspect-[5/3] bg-gray-100">
                <img
                    src={carMainImageUrl(v.id)}
                    alt={`${v.make} ${v.model} ${v.year}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                />
                <ListingBadge isAvailable={v.isAvailable} className="absolute left-3 top-3" />
            </div>
            <div className="p-4">
                <h2 className="text-lg font-bold text-black group-hover:underline">{v.make} {v.model} {v.year}</h2>
                <p className="text-gray-700">{[v.trim, v.licensePlate].filter(Boolean).join(' • ') || '—'}</p>
                {/* One line, as on Turo: the status gives way (truncated, full text
                    on hover) rather than pushing the rating onto a second line,
                    which made every card in the row taller. */}
                <div className="mt-1 flex items-center justify-between gap-3 text-sm">
                    <span
                        title={vehicleStatusText(v.status)}
                        className={cn('min-w-0 truncate', v.status.kind === 'on-trip' ? 'font-semibold text-emerald-800' : 'text-gray-800')}
                    >
                        {vehicleStatusText(v.status)}
                    </span>
                    <RatingLine vehicle={v} />
                </div>
            </div>
        </Link>
    )
}

function VehicleTable({ vehicles }: { vehicles: VehicleListRow[] }) {
    const navigate = useNavigate()
    return (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                    <tr>
                        <th className="px-4 py-3 font-semibold">Vehicle</th>
                        <th className="px-4 py-3 font-semibold">Listing</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold text-right">Base price</th>
                        <th className="px-4 py-3 font-semibold text-right">Booked (30 days)</th>
                        <th className="px-4 py-3 font-semibold text-right">Rating (trips)</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {vehicles.map(v => (
                        <tr
                            key={v.id}
                            onClick={() => navigate({ to: '/admin/vehicles/$carId', params: { carId: String(v.id) } })}
                            className="cursor-pointer hover:bg-gray-50"
                        >
                            <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <img src={carMainImageUrl(v.id)} alt="" className="h-10 w-16 rounded object-cover" loading="lazy" decoding="async" />
                                    <div>
                                        <Link
                                            to="/admin/vehicles/$carId"
                                            params={{ carId: String(v.id) }}
                                            className="font-semibold text-black hover:underline"
                                            onClick={e => e.stopPropagation()}
                                        >
                                            {v.make} {v.model} {v.year}
                                        </Link>
                                        <p className="text-gray-600">{[v.trim, v.licensePlate].filter(Boolean).join(' • ') || '—'}</p>
                                    </div>
                                </div>
                            </td>
                            <td className="px-4 py-3"><ListingBadge isAvailable={v.isAvailable} /></td>
                            <td className="px-4 py-3 text-gray-800">{vehicleStatusText(v.status)}</td>
                            <td className="px-4 py-3 text-right">${v.pricePerDay} / day</td>
                            <td className="px-4 py-3 text-right">{v.bookedDays} {v.bookedDays === 1 ? 'day' : 'days'}</td>
                            <td className="px-4 py-3 text-right"><RatingLine vehicle={v} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
