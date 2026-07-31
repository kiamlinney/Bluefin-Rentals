import { useMemo, useState } from "react";
import { X, CalendarOff, CarFront} from 'lucide-react'
import { Link } from "@tanstack/react-router";
import { Booking, Car } from 'src/types.ts'
import { upsertPriceOverrides, createBlockedDates, deleteBlockedDate } from "@/lib/db.ts";

export type PanelTab = 'prices' | 'unavailability' | 'trips'

type BlockedDate = {
    id: string
    car_id: number
    start_date: string
    end_date: string
    reason: string | null
}

export type SelectionPanelProps = {
    selectionInfo: { totalCells: number; uniqueDates: number; uniqueCars: number }
    activeTab: PanelTab
    setActiveTab: (tab: PanelTab) => void
    onClose: () => void
    selectedCells: Set<string>
    bookings: Booking[]
    cars: Car[]
    dateRange: Date[]
    dateToIndex: (isoString: string) => number
    priceOverrideMap: Map<string, number>
    onPricesUpdated: (updates: { carId: number; date: string; price: number }[]) => void
    blockedDates: BlockedDate[]
    onBlocksCreated: (blocks: BlockedDate[]) => void
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
    priceOverrideMap,
    onPricesUpdated,
    blockedDates,
    onBlocksCreated,
    onBlockDeleted,
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

                {/*<div className="h-10 rounded-lg bg-gray-100 animate-pulse" />*/}
                {/*<button*/}
                {/*    type="button"*/}
                {/*    disabled*/}
                {/*    className="mt-3 w-full py-2.5 rounded-lg bg-gray-100 text-gray-400 text-sm font-medium cursor-not-allowed"*/}
                {/*>*/}
                {/*    Update {selectionInfo.uniqueDates} {selectionInfo.uniqueDates === 1 ? 'date' : 'dates'}*/}
                {/*</button>*/}
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
    blockedDates: BlockedDate[]
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
    const selectionByCarId = useMemo(() => {
        const map = new Map<number, { minDateIndex: number; maxDateIndex: number }>()
        for (const key of selectedCells) {
            const { carId, dateIndex } = parseCellKey(key)
            const existing = map.get(carId)
            if (!existing) {
                map.set(carId, { minDateIndex: dateIndex, maxDateIndex: dateIndex })
            } else {
                map.set(carId, {
                    minDateIndex: Math.min(existing.minDateIndex, dateIndex),
                    maxDateIndex: Math.max(existing.maxDateIndex, dateIndex),
                })
            }
        }
        return map
    }, [selectedCells])

    // Find any existing blocked date ranges that overlap the current selection
    const overlappingBlocks = useMemo(() => {
        return blockedDates.filter(block => {
            const carDates = selectionByCarId.get(block.car_id)
            if (!carDates) return false
            const blockStart = new Date(`${block.start_date}T00:00:00`)
            const blockEnd = new Date(`${block.end_date}T00:00:00`)
            const selStart = dateRange[carDates.minDateIndex]
            const selEnd = dateRange[carDates.maxDateIndex]
            if (!selStart || !selEnd) return false
            return blockStart <= selEnd && blockEnd >= selStart
        })
    }, [blockedDates, selectionByCarId, dateRange])

    const handleBlock = async () => {
        setSaving(true)
        setError(null)
        try {
            const blocks = Array.from(selectionByCarId.entries()).map(([carId, { minDateIndex, maxDateIndex }]) => {
                const startDate = dateRange[minDateIndex]
                const endDate = dateRange[maxDateIndex]
                return {
                    carId,
                    startDate: startDate!.toLocaleDateString('en-CA'),
                    endDate: endDate!.toLocaleDateString('en-CA'),
                    reason: reason.trim() || undefined,
                }
            })

            const result = await createBlockedDates({ data: { blocks } })

            // Build optimistic BlockedDate objects for immediate local state update
            // ids here are temporary, real ids come from Supabase on next loader fetch
            const newBlocks: BlockedDate[] = blocks.map((b, i) => ({
                id: `temp-${Date.now()}-${i}`,
                car_id: b.carId,
                start_date: b.startDate,
                end_date: b.endDate,
                reason: b.reason ?? null,
            }))

            onBlocksCreated(newBlocks)
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
                                            {block.start_date} → {block.end_date}
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
                <p className="text-xs text-gray-500 mb-4">
                    Block {selectionInfo.uniqueDates} {selectionInfo.uniqueDates === 1 ? 'date' : 'dates'} across{' '}
                    {selectionInfo.uniqueCars} {selectionInfo.uniqueCars === 1 ? 'vehicle' : 'vehicles'}.
                    Blocked dates cannot be booked by guests.
                </p>

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
                    {saving ? 'Blocking...' : `+ Block ${selectionInfo.uniqueDates} ${selectionInfo.uniqueDates === 1 ? 'date' : 'dates'}`}
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
                const shortId = booking.id.slice(0, 8).toUpperCase()

                return (
                    <Link
                        key={booking.id}
                        to="/admin/reservation/$bookingId"
                        params={{ bookingId: booking.id }}
                        className="block px-2 mb-2"
                    >

                        <div className="flex items-stretch justify-between gap-4 border border-gray-300 rounded-xl px-4 py-4 hover:shadow-sm hover:border-gray-300 transition-colors">
                            {/* Left – dates, address, renter */}
                            <div className="flex-1 min-w-0">
                                {/* Dates row */}
                                <div className="grid grid-cols-[auto_24px_auto] items-center gap-4">
                                    {/* Start date */}
                                    <div>
                                        <div className="text-lg font-bold text-gray-900 leading-6">{formatLocalDate(booking.start_time)}</div>
                                        <div className="text-base text-gray-800 mt-0.5">{formatLocalTime(booking.start_time)}</div>
                                    </div>

                                    {/* Arrow */}
                                    <div className="text-black text-center text-2xl">→</div>

                                    {/* End date */}
                                    <div className="text-right">
                                        <div className="text-lg font-bold text-gray-900 leading-6">{formatLocalDate(booking.end_time)}</div>
                                        <div className="text-base text-gray-800 mt-0.5">{formatLocalTime(booking.end_time)}</div>
                                    </div>
                                </div>

                                {/* Address */}
                                {booking.pickup_location && (
                                    <p className="text-sm text-gray-700 mt-3 truncate">{booking.pickup_location}</p>
                                )}

                                {/* Renter */}
                                <div className="flex items-center gap-2 mt-3">
                                    <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-800 text-xs font-semibold flex items-center justify-center">
                                        {renterName[0]?.toUpperCase() ?? 'G'}
                                    </div>
                                    <span className="text-xs text-gray-700 truncate">{renterName} #{shortId}</span>
                                </div>
                            </div>

                            {/* Right – car tile */}
                            {car && (
                                <div className="flex flex-col items-center gap-2 shrink-0">
                                    <img
                                        src={`https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${car.id}/main.PNG`}
                                        alt={`${car.year} ${car.make} ${car.model}`}
                                        className="w-20 h-14 object-cover rounded-md border border-gray-100"
                                    />
                                    <div className="text-xs text-gray-600">{car.license_plate}</div>
                                </div>
                            )}
                        </div>
                    </Link>
                )
            })}
        </div>
    )
}