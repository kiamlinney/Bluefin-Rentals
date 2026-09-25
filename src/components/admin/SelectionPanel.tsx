import { useMemo, useState } from "react";
import { X, CarFront} from 'lucide-react'
import { Link } from "@tanstack/react-router";
import { BookingWithRelations, Car, CarBlockedDate, TuroBooking } from 'src/types.ts'
import { upsertPriceOverrides, createBlockedDates, deleteBlockedDate } from "@/lib/db.ts";
import { formatBusinessDate, formatBusinessTime, formatDateKey } from "@/lib/dates.ts";
import { dateKeyToLocalDate } from "@/lib/pricing.ts";
import { carMainImageUrl } from "@/lib/car-images.ts";

export type PanelTab = 'prices' | 'unavailability' | 'trips'

export type SelectionPanelProps = {
    selectionInfo: { totalCells: number; uniqueDates: number; uniqueCars: number }
    activeTab: PanelTab
    setActiveTab: (tab: PanelTab) => void
    onClose: () => void
    rangeMode: boolean
    setRangeMode: (on: boolean) => void
    selectedCells: Set<string>
    bookings: BookingWithRelations[]
    turoBookings: TuroBooking[]
    cars: Car[]
    dateRange: Date[]
    dateToIndex: (isoString: string) => number
    priceOverrideMap: Map<string, number>
    onPricesUpdated: (updates: { carId: number; date: string; price: number }[]) => void
    blockedDates: CarBlockedDate[]
    onBlocksCreated: (blocks: CarBlockedDate[]) => void
    onBlockDeleted: (blockId: string) => void
}

const TABS: { id: PanelTab; label: string }[] = [
    { id: 'prices',         label: 'Prices'         },
    { id: 'unavailability', label: 'Unavailability' },
    { id: 'trips',          label: 'Trips'          },
]

function parseCellKey(key: string): { carId: number; dateIndex: number } {
    const parts = key.split(':')
    return {
        carId: Number(parts[0] ?? 0),
        dateIndex: Number(parts[1] ?? 0),
    }
}

// These were already correct — they just spelled the zone out inline. Routed
// through src/lib/dates.ts so there's one definition of "business time" to
// change if the lot ever moves, rather than a string to go hunting for.
const formatLocalTime = formatBusinessTime
const formatLocalDate = formatBusinessDate

// --- Selection Panel
// A fixed position panel that overlays the right edge of the screen whenever one or more
// calendar cells are selected. It does not push or compress the grid, it floats on top.
// On phones it's a bottom sheet instead, leaving the top of the grid tappable.
export function SelectionPanel({
    selectionInfo,
    activeTab,
    setActiveTab,
    onClose,
    rangeMode,
    setRangeMode,
    selectedCells,
    bookings,
    turoBookings,
    cars,
    dateRange,
    dateToIndex,
    priceOverrideMap,
    onPricesUpdated,
    blockedDates,
    onBlocksCreated,
    onBlockDeleted,
}: SelectionPanelProps) {
    return (
        <div className="fixed inset-x-0 bottom-0 h-[50dvh] rounded-t-2xl md:inset-x-auto md:bottom-auto md:right-0 md:top-19.5 md:h-160 md:w-90 md:rounded-xl z-50 bg-white border-1 border-gray-200 shadow-2xl flex flex-col">

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

                <div className="flex items-center gap-2">
                    {/* Shift-click for touch screens: the next tap fills a rectangle
                        from the last cell tapped. Desktop still has shift, so phones only. */}
                    <button
                        type="button"
                        onClick={() => setRangeMode(!rangeMode)}
                        aria-pressed={rangeMode}
                        className={[
                            'md:hidden px-3 py-1.5 rounded-full border text-xs font-medium transition-colors cursor-pointer',
                            rangeMode
                                ? 'bg-emerald-700 border-emerald-700 text-white'
                                : 'border-gray-300 text-gray-700',
                        ].join(' ')}
                    >
                        {rangeMode ? 'Tap end cell' : 'Select range'}
                    </button>

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
                    <PricesTab
                        selectedCells={selectedCells}
                        cars={cars}
                        dateRange={dateRange}
                        priceOverrideMap={priceOverrideMap}
                        selectionInfo={selectionInfo}
                        onPricesUpdated={onPricesUpdated}/>
                )}

                {activeTab === 'unavailability' && (
                    <UnavailabilityTab
                        selectedCells={selectedCells}
                        cars={cars}
                        dateRange={dateRange}
                        blockedDates={blockedDates}
                        selectionInfo={selectionInfo}
                        onBlocksCreated={onBlocksCreated}
                        onBlockDeleted={onBlockDeleted}
                    />
                )}

                {activeTab === 'trips' && (
                    <TripsTab
                        selectedCells={selectedCells}
                        bookings={bookings}
                        turoBookings={turoBookings}
                        cars={cars}
                        dateToIndex={dateToIndex}
                    />
                )}
            </div>
        </div>
    )
}

function PricesTab({
   selectedCells, cars, dateRange, priceOverrideMap, selectionInfo, onPricesUpdated,
}: {
    selectedCells: Set<string>
    cars: Car[]
    dateRange: Date[]
    priceOverrideMap: Map<string, number>
    selectionInfo: SelectionPanelProps['selectionInfo']
    onPricesUpdated: SelectionPanelProps['onPricesUpdated']
}) {
    const [adjustMode, setAdjustMode] = useState<'dollar' | 'percent'>('dollar')
    const [adjustValue, setAdjustValue] = useState('')
    const [setValue, setSetValue] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [successMsg, setSuccessMsg] = useState<string | null>(null)

    const carsById = useMemo(() => {
        const map = new Map<number, Car>()
        for (const car of cars) map.set(car.id, car)
        return map
    }, [cars])

    // Resolves the current displayed price for one cell, override (if set) -> car base price
    const getCurrentPrice = (carId: number, dateIndex: number): number => {
        const date = dateRange[dateIndex]
        if (!date) return 0
        const dateStr = date.toLocaleDateString('en-CA')
        const car = carsById.get(carId)
        return priceOverrideMap.get(`${carId}:${dateStr}`) ?? car?.price_per_day ?? 0
    }

    // Builds the updates array from selectedCells using a price computing callback
    const buildUpdates = (computePrice: (current: number) => number) => {
        const updates: { carId: number; date: string; price: number }[] = []
        for (const key of selectedCells) {
            const { carId, dateIndex } = parseCellKey(key)
            const date = dateRange[dateIndex]
            if (!date) continue
            const dateStr = date.toLocaleDateString('en-CA')
            const current = getCurrentPrice(carId, dateIndex)
            const newPrice = Math.max(1, Math.round(computePrice(current) * 100) / 100)
            updates.push({ carId, date: dateStr, price: newPrice })
        }
        return updates
    }

    const showSuccess = (msg: string) => {
        setSuccessMsg(msg)
        setTimeout(() => setSuccessMsg(null), 2500)
    }

    const handleAdjust = async () => {
        const amount = Number(adjustValue)
        if (!adjustValue.trim() || isNaN(amount)) {
            setError('Please enter a valid amount')
            return
        }
        setSaving(true)
        setError(null)
        try {
            const updates = buildUpdates(current =>
                adjustMode === 'dollar'
                    ? current + amount
                    : current * (1 + amount / 100)
            )
            await upsertPriceOverrides({ data: { overrides: updates } })
            onPricesUpdated(updates)
            setAdjustValue('')
            showSuccess(`Updated ${updates.length} ${updates.length === 1 ? 'price' : 'prices'}`)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to update prices')
        } finally {
            setSaving(false)
        }
    }

    const handleSet = async () => {
        const price = Number(setValue)
        if (!setValue.trim() || isNaN(price) || price <= 0) {
            setError('Please enter a valid price greater than $0')
            return
        }
        setSaving(true)
        setError(null)
        try {
            const updates = buildUpdates(() => price)
            await upsertPriceOverrides({ data: { overrides: updates } })
            onPricesUpdated(updates)
            setSetValue('')
            showSuccess(`Set ${updates.length} ${updates.length === 1 ? 'price' : 'prices'} to $${price}`)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to set prices')
        } finally {
            setSaving(false)
        }
    }

    const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-gray-400 transition-colors"

    return (
        <div className="p-5 space-y-6">

            {/* --- Adjust Section ----------------- */}
            <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Adjust</h3>
                <p className="text-xs text-gray-500 mb-4">
                    Add or reduce all selected prices by a dollar or percentage amount.
                </p>

                {/* Dollar / Percent toggle */}
                <div className="flex rounded-lg border border-gray-200 mb-3 overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setAdjustMode('dollar')}
                        className={[
                            'flex-1 py-2 text-sm transition-colors cursor-pointer',
                            adjustMode === 'dollar' ? 'bg-gray-700 text-white' : 'bg-white text-gray-500 hover:bg-gray-50',
                        ].join(' ')}
                    >
                        $
                    </button>
                    <button
                        type="button"
                        onClick={() => setAdjustMode('percent')}
                        className={[
                            'flex-1 py-2 text-sm transition-colors cursor-pointer',
                            adjustMode === 'percent' ? 'bg-gray-700 text-white' : 'bg-white text-gray-500 hover:bg-gray-50',
                        ].join(' ')}
                    >
                        %
                    </button>
                </div>

                {/* Amount input */}
                <div className="relative mb-3">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-900">
                        {adjustMode === 'dollar' ? '$' : '%'}
                    </span>
                    <input
                        type="number"
                        placeholder={adjustMode === 'dollar' ? 'e.g. +10, -5' : 'e.g. +20, -10'}
                        value={adjustValue}
                        onChange={e => { setAdjustValue(e.target.value); setError(null) }}
                        className={inputClass + ' pl-7'}
                    />
                </div>

                <button
                    type="button"
                    onClick={handleAdjust}
                    disabled={saving || !adjustValue.trim()}
                    className="w-full py-2.5 rounded-lg bg-gray-700 text-white text-sm hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                    {saving ? 'Saving...' : `Update ${selectionInfo.uniqueDates} ${selectionInfo.uniqueDates === 1 ? 'date' : 'dates'}`}
                </button>
            </div>

            <hr className="border-gray-100" />

            {/* -- Set section -------------------------- */}
            <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Set</h3>
                <p className="text-xs text-gray-500 mb-4">
                    Set all selected prices to the same value.
                </p>

                <div className="relative mb-3">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-900">$</span>
                    <input
                        type="number"
                        min="1"
                        placeholder="e.g. 75"
                        value={setValue}
                        onChange={e => { setSetValue(e.target.value); setError(null) }}
                        className={inputClass + ' pl-7'}
                    />
                </div>

                <button
                    type="button"
                    onClick={handleSet}
                    disabled={saving || !setValue.trim()}
                    className="w-full py-2.5 rounded-lg bg-gray-700 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                    {saving ? 'Saving...' : `Set ${selectionInfo.uniqueDates} ${selectionInfo.uniqueDates === 1 ? 'date' : 'dates'}`}
                </button>
            </div>

            {/*<hr className="border-gray-100" />*/}

            {/* Error / success feedback */}
            {error && <p className="text-xs text-red-600">{error}</p>}
            {successMsg && <p className="text-xs text-green-700 font-medium">{successMsg}</p>}
        </div>
    )
}

function UnavailabilityTab({
   selectedCells, cars, dateRange, blockedDates, selectionInfo, onBlocksCreated, onBlockDeleted,
}: {
    selectedCells: Set<string>
    cars: Car[]
    dateRange: Date[]
    blockedDates: CarBlockedDate[]
    selectionInfo: SelectionPanelProps['selectionInfo']
    onBlocksCreated: SelectionPanelProps['onBlocksCreated']
    onBlockDeleted: SelectionPanelProps['onBlockDeleted']
}) {
    const [reason, setReason] = useState('')
    const [saving, setSaving] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [successMsg, setSuccessMsg] = useState<string | null>(null)

    const carsById = useMemo(() => {
        const map = new Map<number, Car>()
        for (const car of cars) map.set(car.id, car)
        return map
    }, [cars])

    // Build a Map<carId, { minDate, maxDate }> from the selection.
    // For each car in the selection, we find the earliest and latest selected
    // date to create a single contiguous blocked range per car.
    // selectedDays is tracked alongside so the panel can tell how many days the
    // range picks up that were never actually clicked.
    const selectionByCarId = useMemo(() => {
        const map = new Map<number, { minDateIndex: number; maxDateIndex: number; selectedDays: number }>()
        for (const key of selectedCells) {
            const { carId, dateIndex } = parseCellKey(key)
            const existing = map.get(carId)
            if (!existing) {
                map.set(carId, { minDateIndex: dateIndex, maxDateIndex: dateIndex, selectedDays: 1 })
            } else {
                map.set(carId, {
                    minDateIndex: Math.min(existing.minDateIndex, dateIndex),
                    maxDateIndex: Math.max(existing.maxDateIndex, dateIndex),
                    selectedDays: existing.selectedDays + 1,
                })
            }
        }
        return map
    }, [selectedCells])

    // What blocking will actually write, per vehicle — the collapsed min→max
    // range, not the cells that happen to be highlighted. The button used to be
    // labelled from the selected-cell count, so picking 8/15 and 8/19 offered to
    // "Block 2 dates" and then wrote five days.
    const resolvedRanges = useMemo(() => {
        return Array.from(selectionByCarId.entries()).flatMap(([carId, span]) => {
            const start = dateRange[span.minDateIndex]
            const end = dateRange[span.maxDateIndex]
            if (!start || !end) return []
            const spanDays = span.maxDateIndex - span.minDateIndex + 1
            return [{
                carId,
                startDate: start.toLocaleDateString('en-CA'),
                endDate: end.toLocaleDateString('en-CA'),
                spanDays,
                gapDays: spanDays - span.selectedDays,
            }]
        })
    }, [selectionByCarId, dateRange])

    // The largest span across vehicles, which is what the button acts on. Summing
    // would overcount: blocking 5 days on 3 cars is still a 5-day block.
    const daysToBlock = useMemo(
        () => resolvedRanges.reduce((max, r) => Math.max(max, r.spanDays), 0),
        [resolvedRanges],
    )
    const totalGapDays = useMemo(
        () => resolvedRanges.reduce((sum, r) => sum + r.gapDays, 0),
        [resolvedRanges],
    )

    // Find any existing blocked date ranges that overlap the current selection
    const overlappingBlocks = useMemo(() => {
        return blockedDates.filter(block => {
            const carDates = selectionByCarId.get(block.car_id)
            if (!carDates) return false
            // Blocked dates are stored as bare date keys, so they're compared at
            // local midnight against dateRange, which is built the same way.
            const blockStart = dateKeyToLocalDate(block.start_date)
            const blockEnd = dateKeyToLocalDate(block.end_date)
            const selStart = dateRange[carDates.minDateIndex]
            const selEnd = dateRange[carDates.maxDateIndex]
            if (!selStart || !selEnd || !blockStart || !blockEnd) return false
            return blockStart <= selEnd && blockEnd >= selStart
        })
    }, [blockedDates, selectionByCarId, dateRange])

    const handleBlock = async () => {
        setSaving(true)
        setError(null)
        try {
            const blocks = resolvedRanges.map(r => ({
                carId: r.carId,
                startDate: r.startDate,
                endDate: r.endDate,
                reason: reason.trim() || undefined,
            }))

            const result = await createBlockedDates({ data: { blocks } })

            // The inserted rows come straight back from Supabase, so the grid
            // gets real uuids. 
            onBlocksCreated(result.blocks)
            setReason('')
            setSuccessMsg(`Blocked ${result.created} ${result.created === 1 ? 'vehicle' : 'vehicles'}`)
            setTimeout(() => setSuccessMsg(null), 2500)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to block dates')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (blockId: string) => {
        setDeletingId(blockId)
        setError(null)
        try {
            await deleteBlockedDate({ data: blockId })
            onBlockDeleted(blockId)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to remove block')
        } finally {
            setDeletingId(null)
        }
    }

    return (
        <div className="p-5 space-y-5">
            {/* Existing overlapping blocks */}
            {overlappingBlocks.length > 0 && (
                <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Currently blocked</h3>
                    <div className="space-y-2">
                        {overlappingBlocks.map(block => {
                            const car = carsById.get(block.car_id)
                            return (
                                <div key={block.id}
                                     className="flex items-start justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 gap-2">
                                    <div className="min-w-0">
                                        <p className="text-xs font-medium text-gray-900 truncate">
                                            {car ? `${car.make} ${car.model} ${car.year}` : `Car #${block.car_id}`}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-0.5">
                                            {formatDateKey(block.start_date)}
                                            {block.end_date !== block.start_date && ` → ${formatDateKey(block.end_date)}`}
                                        </p>
                                        {block.reason && (
                                            <p className="text-xs text-gray-400 mt-0.5 truncate">{block.reason}</p>
                                        )}
                                    </div>
                                    <button type="button"
                                            onClick={() => handleDelete(block.id)}
                                            disabled={deletingId === block.id}
                                            className="text-xs text-red-500 hover:text-red-700 flex-shrink-0 disabled:opacity-40 cursor-pointer">
                                        {deletingId === block.id ? '...' : 'Remove'}
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                    <hr className="border-gray-100 mt-4" />
                </div>
            )}

            {/* Block new dates section */}
            <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Block availability</h3>
                <p className="text-xs text-gray-500 mb-3">
                    Block {daysToBlock} {daysToBlock === 1 ? 'day' : 'days'} across{' '}
                    {selectionInfo.uniqueCars} {selectionInfo.uniqueCars === 1 ? 'vehicle' : 'vehicles'}.
                    Blocked dates cannot be booked by guests.
                </p>

                {/* The exact range each vehicle will get. Blocking collapses a
                    selection to one min→max range per car */}
                <div className="mb-3 space-y-1.5">
                    {resolvedRanges.map(r => {
                        const car = carsById.get(r.carId)
                        return (
                            <p key={r.carId} className="text-xs text-gray-700">
                                <span className="font-medium">
                                    {car ? `${car.make} ${car.model} ${car.year}` : `Car #${r.carId}`}
                                </span>
                                {' — '}
                                {formatDateKey(r.startDate)}
                                {r.endDate !== r.startDate && ` → ${formatDateKey(r.endDate)}`}
                                {' '}({r.spanDays} {r.spanDays === 1 ? 'day' : 'days'})
                            </p>
                        )
                    })}
                </div>

                {totalGapDays > 0 && (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                        <p className="text-xs text-amber-800">
                            ⚠ {totalGapDays} unselected {totalGapDays === 1 ? 'day' : 'days'} in between
                            will also be blocked.
                        </p>
                    </div>
                )}

                {/* Optional reason input */}
                <input
                    type="text"
                    placeholder="Reason (optional, e.g. maintenance)"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-gray-400 transition-colors mb-3"
                />

                <button type="button" onClick={handleBlock} disabled={saving}
                        className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                    {saving ? 'Blocking...' : `+ Block ${daysToBlock} ${daysToBlock === 1 ? 'day' : 'days'}`}
                </button>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
            {successMsg && <p className="text-xs text-green-700 font-medium">{successMsg}</p>}
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

// Turo trips are listed alongside direct bookings, tagged so each card knows
// where to link: our reservation page, or the trip on turo.com.
type TripItem =
    | { kind: 'direct'; booking: BookingWithRelations }
    | { kind: 'turo'; trip: TuroBooking }

function turoReservationUrl(turoTripId: string) {
    return `https://turo.com/us/en/reservation/${turoTripId}`
}

function TripsTab({
     selectedCells,
     bookings,
     turoBookings,
     cars,
     dateToIndex,
}: {
    selectedCells: Set<string>
    bookings: BookingWithRelations[]
    turoBookings: TuroBooking[]
    cars: Car[]
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

    // Filter both kinds of trip to only those relevant to the current selection,
    // through the same overlap rule so a Turo trip and a direct booking on the
    // same cells can't disagree about whether they're "selected"
    const relevantTrips = useMemo(() => {
        const overlapsSelection = (trip: { car_id: number; start_time: string; end_time: string }) => {
            const carSelectedDates = selectedCarDateMap.get(trip.car_id)

            if (!carSelectedDates || carSelectedDates.size === 0) return false

            const tripStart = dateToIndex(trip.start_time)
            const tripEnd = dateToIndex(trip.end_time)

            for (const di of carSelectedDates) {
                if (di >= tripStart && di <= tripEnd) return true
            }
            return false
        }

        const items: TripItem[] = [
            ...bookings.filter(overlapsSelection).map(booking => ({ kind: 'direct' as const, booking })),
            ...turoBookings.filter(overlapsSelection).map(trip => ({ kind: 'turo' as const, trip })),
        ]
        const startOf = (item: TripItem) =>
            new Date(item.kind === 'direct' ? item.booking.start_time : item.trip.start_time).getTime()

        // Sort soonest first
        return items.sort((a, b) => startOf(a) - startOf(b))
    }, [bookings, turoBookings, selectedCarDateMap, dateToIndex])

    if (relevantTrips.length === 0) {
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
                Showing {relevantTrips.length} {relevantTrips.length === 1 ? 'trip' : 'trips'} for the selected days.
            </p>

            {relevantTrips.map(item => {
                if (item.kind === 'direct') {
                    const booking = item.booking
                    const profile = booking.profiles
                    const renterName = profile?.full_name ?? profile?.email?.split('@')[0] ?? 'Guest'
                    const shortId = booking.id.slice(0, 8).toUpperCase()

                    return (
                        <Link
                            key={booking.id}
                            to="/admin/reservation/$bookingId"
                            params={{ bookingId: booking.id }}
                            className="block px-2 mb-2"
                        >
                            <TripCardBody
                                startTime={booking.start_time}
                                endTime={booking.end_time}
                                address={booking.pickup_location}
                                renterName={renterName}
                                reference={`#${shortId}`}
                                car={carsById.get(booking.car_id)}
                            />
                        </Link>
                    )
                }

                const trip = item.trip
                const body = (
                    <TripCardBody
                        startTime={trip.start_time}
                        endTime={trip.end_time}
                        address={null}
                        renterName={trip.renter_name ?? 'Turo guest'}
                        reference={trip.turo_trip_id ? `Turo ID #${trip.turo_trip_id}` : 'Turo'}
                        car={carsById.get(trip.car_id)}
                        isTuro
                    />
                )

                // Rows synced before the reservation id was captured have nothing
                // to link to, so they're shown but not clickable
                if (!trip.turo_trip_id) {
                    return <div key={trip.id} className="block px-2 mb-2">{body}</div>
                }

                return (
                    <a
                        key={trip.id}
                        href={turoReservationUrl(trip.turo_trip_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-2 mb-2"
                    >
                        {body}
                    </a>
                )
            })}
        </div>
    )
}

// The card itself, shared by direct bookings and Turo trips so the two read the
// same in the list. Turo trips get a violet badge, matching their bar on the grid.
function TripCardBody({
    startTime,
    endTime,
    address,
    renterName,
    reference,
    car,
    isTuro = false,
}: {
    startTime: string
    endTime: string
    address: string | null
    renterName: string
    reference: string
    car: Car | undefined
    isTuro?: boolean
}) {
    return (
        <div className={`flex items-stretch justify-between gap-4 border border-gray-300 rounded-xl px-4 py-4 hover:shadow-sm hover:border-gray-300 transition-colors
            ${isTuro && 'bg-violet-500/10'}`}
        >
            {/* Left – dates, address, renter */}
            <div className="flex-1 min-w-0">
                {/* Dates row */}
                <div className="grid grid-cols-[auto_24px_auto] items-center gap-4">
                    {/* Start date */}
                    <div>
                        <div className="text-lg font-bold text-gray-900 leading-6">{formatLocalDate(startTime)}</div>
                        <div className="text-base text-gray-800 mt-0.5">{formatLocalTime(startTime)}</div>
                    </div>

                    {/* Arrow */}
                    <div className="text-black text-center text-2xl">→</div>

                    {/* End date */}
                    <div className="text-right">
                        <div className="text-lg font-bold text-gray-900 leading-6">{formatLocalDate(endTime)}</div>
                        <div className="text-base text-gray-800 mt-0.5">{formatLocalTime(endTime)}</div>
                    </div>
                </div>


                {/* Address */}
                {address && (
                    <p className="text-sm text-gray-700 mt-3 truncate">{address}</p>
                )}

                {/* Renter */}
                <div className="flex items-center gap-2 mt-3">
                    <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-800 text-xs font-semibold flex items-center justify-center">
                        {renterName[0]?.toUpperCase() ?? 'G'}
                    </div>
                    <span className="text-xs text-gray-700 truncate">{renterName} {reference}</span>
                </div>

                {isTuro && (
                    <p className="text-xs text-gray-700 italic mt-3 truncate">Click to open reservation in Turo.</p>
                )}
            </div>

            {/* Right – car tile */}
            {car && (
                <div className="flex flex-col items-center gap-2 shrink-0">
                    {isTuro && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 bg-violet-200 rounded-full px-2 py-0.5">
                            Turo
                        </span>
                    )}
                    <img
                        src={carMainImageUrl(car.id)}
                        alt={`${car.make} ${car.model} ${car.year}`}
                        className="w-20 h-14 object-cover rounded-md border border-gray-100"
                        loading="lazy"
                        decoding="async"
                    />
                    <div className="text-xs text-gray-600">{car.license_plate}</div>
                </div>
            )}
        </div>
    )
}