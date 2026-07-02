import { X, DollarSign, CalendarOff, CarFront} from 'lucide-react'
import { Booking, Car } from 'src/types.ts'
import { useMemo} from "react";
import  {Link } from "@tanstack/react-router";

export type PanelTab = 'prices' | 'unavailability' | 'trips'

export type SelectionPanelProps = {
    selectionInfo: {
        totalCells: number
        uniqueDates: number
        uniqueCars: number
    }

    activeTab: PanelTab
    setActiveTab: (tab: PanelTab) => void

    onClose: () => void

    selectedCells: Set<string>
    bookings: Booking[]
    cars: Car[]
    dateRange: Date[]
    dateToIndex: (isoString: string) => number
}

const TABS: { id: PanelTab; label: string; icon: React.ElementType }[] = [
    { id: 'prices',         label: 'Prices',         icon: DollarSign  },
    { id: 'unavailability', label: 'Unavailability',  icon: CalendarOff },
    { id: 'trips',          label: 'Trips',           icon: CarFront      },
]

function parseCellKey(key: string): { carId: number; dateIndex: number } {
    const parts = key.split(':')
    return {
        carId: Number(parts[0] ?? 0),
        dateIndex: Number(parts[1] ?? 0),
    }
}

function formatLocalTime(isoString: string): string {
    return new Date(isoString).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
    })
}

function formatLocalDate(isoString: string): string {
    return new Date(isoString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'America/Chicago',
    })
}

// --- Selection Panel
// A fixed position panel that overlays the right edge of the screen whenever one or more
// calendar cells are selected. It does not push or compress the grid, it floats on top.`
export function SelectionPanel({
    selectionInfo,
    activeTab,
    setActiveTab,
    onClose,
    selectedCells,
    bookings,
    cars,
    dateRange,
    dateToIndex,
}: SelectionPanelProps) {
    return (
        <div className="fixed right-0 top-19.5 h-160 w-90 z-50 rounded-xl bg-white border-1 border-gray-200 shadow-2xl flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                {/* Selection summary that updates live as cells are added and removed */}
                <div>
                    <p className="text-sm font-semibold text-black">
                        {selectionInfo.uniqueDates === 1
                            ? '1 date selected'
                            : `${selectionInfo.uniqueDates} dates selected`}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {selectionInfo.uniqueCars === 1
                            ? '1 vehicle'
                            : `${selectionInfo.uniqueCars} vehicles`}
                        {' · '}
                        {selectionInfo.totalCells} {selectionInfo.totalCells === 1 ? 'cell' : 'cells'}
                    </p>
                </div>

                {/* Close button */}
                <button
                    type="button"
                    onClick={onClose}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-900 hover:text-gray-700 transition-colors cursor-pointer"
                    aria-label="Close panel"
                >
                    <X size={16} />
                </button>
            </div>

            {/*--- Tab Bar ----------------------*/}
            <div className="flex border-b borger-gray-100">
                {TABS.map(tab => {
                    // const Icon = tab.icon
                    const isActive = activeTab === tab.id
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={[
                                'flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors cursor-pointer',
                                'border-b-2',
                                isActive
                                    ? 'border-gray-900 text-gray-900'
                                    : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-200',
                            ].join(' ')}
                        >
                            {/*<Icon size={16} />*/}
                            {tab.label}
                        </button>

                    )
                })}
            </div>

            {/* Tab content*/}
            <div className="flex-1 overflow-y-auto">

                {activeTab === 'prices' && (
                    <PricesTab selectionInfo={selectionInfo} />
                )}

                {activeTab === 'unavailability' && (
                    <UnavailabilityTab selectionInfo={selectionInfo} />
                )}

                {activeTab === 'trips' && (
                    <TripsTab
                        selectedCells={selectedCells}
                        bookings={bookings}
                        cars={cars}
                        dateRange={dateRange}
                        dateToIndex={dateToIndex}
                    />
                )}
            </div>
        </div>
    )
}

function PricesTab({
                                  selectionInfo,
                              }: {
    selectionInfo: SelectionPanelProps['selectionInfo']
}) {
    return (
        <div className="p-5 space-y-6">
            {/* Adjust section — Phase 4 will add the dollar/percent toggle and input */}
            <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Adjust</h3>
                <p className="text-xs text-gray-500 mb-4">
                    Add or reduce all selected prices by a dollar or percentage amount.
                </p>
                <div className="h-10 rounded-lg bg-gray-100 animate-pulse" />
                <button
                    type="button"
                    disabled
                    className="mt-3 w-full py-2.5 rounded-lg bg-gray-100 text-gray-400 text-sm font-medium cursor-not-allowed"
                >
                    Update {selectionInfo.uniqueDates} {selectionInfo.uniqueDates === 1 ? 'date' : 'dates'}
                </button>
            </div>

            <hr className="border-gray-100" />

            {/* Set section — Phase 4 will add the price input */}
            <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Set</h3>
                <p className="text-xs text-gray-500 mb-4">
                    Set all selected prices to the same value.
                </p>
                <div className="h-10 rounded-lg bg-gray-100 animate-pulse" />
            </div>

            <hr className="border-gray-100" />

            {/* Coming in Phase 4 notice */}
            <p className="text-xs text-gray-400 text-center">
                Price editing
            </p>
        </div>
    )
}

function UnavailabilityTab({
                                          selectionInfo,
                                      }: {
    selectionInfo: SelectionPanelProps['selectionInfo']
}) {
    return (
        <div className="p-5 flex flex-col items-center justify-center text-center h-full gap-4">
            <CalendarOff size={32} className="text-gray-300" />
            <div>
                <p className="text-sm font-medium text-gray-700">
                    Block {selectionInfo.uniqueDates} {selectionInfo.uniqueDates === 1 ? 'date' : 'dates'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                    Availability blocking
                </p>
            </div>
            <button
                type="button"
                disabled
                className="w-full py-2.5 rounded-lg bg-gray-100 text-gray-400 text-sm font-medium cursor-not-allowed"
            >
                + Block availability
            </button>
        </div>
    )
}

// Derives which bookings overlap the currently selected cells entirely from props
// already passed down from calendar grid.

// Has two parts:
// 1. Which car IDs are in the selection?
//    Walk selectedCells, parse each key, collect unique carId values

// 2. Which date indices are in the selection?
//    Walk selectedCells, parse each key, collect unique dateIndex values

// A booking is relevant if: Its car_id is in the selected car IDs, AND
// its date range overlaps at least one selected date index

function TripsTab({
     selectedCells,
     bookings,
     cars,
     dateRange,
     dateToIndex,
}: {
    selectedCells: Set<string>
    bookings: Booking[]
    cars: Car[]
    dateRange: Date[]
    dateToIndex: (iso: string) => number
}) {
    const carsById = useMemo(() => {
        const map = new Map<number, Car>()
        for (const car of cars) map.set(car.id, car)
        return map
    }, [cars])

    const { selectedCarDateMap } = useMemo(() => {
        const carDateMap = new Map<number, Set<number>>()

        for (const key of selectedCells) {
            const {carId, dateIndex } = parseCellKey(key)
            const existing = carDateMap.get(carId) ?? new Set<number>()
            existing.add(dateIndex)
            carDateMap.set(carId, existing)
        }

        return { selectedCarDateMap: carDateMap }
    }, [selectedCells])

    // Filter bookings to only those relevant to the current selection
    const relevantBookings = useMemo(() => {
        return bookings
            .filter(booking => {
                const carSelectedDates = selectedCarDateMap.get(booking.car_id)

                if (!carSelectedDates || carSelectedDates.size === 0) return false

                const bookingStart = dateToIndex(booking.start_time)
                const bookingEnd = dateToIndex(booking.end_time)

                for (const di of carSelectedDates) {
                    if (di >= bookingStart && di <= bookingEnd) return true
                }
                return false
            })
            .sort((a, b) =>
                // Sort soonest first
                new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
            )
    }, [bookings, selectedCarDateMap, dateToIndex])

    if (relevantBookings.length === 0) {
        return (
            <div className="p-5 flex flex-col items-center justify-center text-center gap-4 h-full">
                <CarFront size={32} className="text-gray-200" />
                <div>
                    <p className="text-sm text-gray-600">No trips for selected dates</p>
                    <p className="text-xs text-gray-400 mt-1">
                        Showing all trips for the selected days.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="divide-y divide-gray-100">
            <p className="px-5 pt-4 pb-2 text-xs text-gray-400">
                Showing {relevantBookings.length} {relevantBookings.length === 1 ? 'trip' : 'trips'} for the selected days.
            </p>

            {relevantBookings.map(booking => {
                const car = carsById.get(booking.car_id)

                // Determine whether this trip is active, upcoming, or past
                const now = new Date()
                const startTime = new Date(booking.start_time)
                const endTime = new Date(booking.end_time)

                const isActive = startTime <= now && endTime > now
                //const isPast = endTime <= now
                const isUpcoming = startTime > now

                let statusLabel = ''
                let statusClass = ''

                if (isActive) {
                    statusLabel = `Ending ${formatLocalDate(booking.end_time)} at ${formatLocalTime(booking.end_time)}`
                    statusClass = 'text-red-600 bg-red-50'
                } else if (isUpcoming) {
                    statusLabel = `Starting ${formatLocalDate(booking.start_time)} at ${formatLocalTime(booking.start_time)}`
                    statusClass = 'text-green-700 bg-green-50'
                } else {
                    // Completed / past trip — show the date range
                    statusLabel = `${formatLocalDate(booking.start_time)} – ${formatLocalDate(booking.end_time)}`
                    statusClass = 'text-gray-500 bg-gray-100'
                }

                const profile = booking.profiles
                const renterName = profile?.full_name ?? profile?.email?.split('@')[0] ?? 'Guest'
                const shortBookingId = booking.id.slice(0, 8).toUpperCase()

                return (
                    <Link
                        key={booking.id}
                        to="/admin/reservation/$bookingId"
                        params={{ bookingId: booking.id }}
                        className="flex gap-3 px-5 py-4 hover:bg-gray-50 transition-colors"
                    >

                        <div className="flex-1 min-w-0">
                            <span className={`inline-block text-xs px-2 py-0.5 rounded-sm mb-1 ${statusClass}`}>
                                {statusLabel}
                            </span>

                            {/*<p className="text-sm font-semibold text-gray-900 truncate">*/}
                            {/*    {car ? `${car.make} ${car.model} ${car.year}` : `Car #${booking.car_id}`}*/}
                            {/*</p>*/}

                            {/* Date range */}
                            <p className="text-xs text-gray-500 mt-0.5">
                                {formatLocalDate(booking.start_time)}, {formatLocalTime(booking.start_time)}
                                {' → '}
                                {formatLocalDate(booking.end_time)}, {formatLocalTime(booking.end_time)}
                            </p>

                            <p className="text-xs text-gray-700 mt-0.5">
                                {booking.pickup_location}
                            </p>

                            {/* Renter info */}
                            <div className="flex items-center gap-2 mt-1">
                                <div className="flex items-center gap-1">
                                    <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                                        {renterName[0]?.toUpperCase() ?? 'G'}
                                    </div>
                                    <span className="text-xs text-gray-500">
                                        {renterName} #{shortBookingId}
                                    </span>
                                </div>
                            </div>

                        </div>

                        {car && (
                            <div>
                                <img
                                    src={`https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${car.id}/main.PNG`}
                                    alt={`${car.year} ${car.make} ${car.model}`}
                                    className="w-16 h-11 object-cover rounded-md flex-shrink-0 mt-0.5 border border-gray-100"
                                />
                                <p className="text-[10px] text-gray-600 text-center">
                                    {car.license_plate}
                                </p>
                            </div>
                        )}
                    </Link>
                )
            })}
        </div>
    )
}