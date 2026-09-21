import {useRef, useMemo, useState, useEffect, useCallback} from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { X } from "lucide-react"
import { BookingWithRelations, Car, CarBlockedDate, TuroBooking } from "src/types.ts";
import { MonthPicker } from "@/components/admin/MonthPicker.tsx";
import { SelectionPanel } from "@/components/admin/SelectionPanel.tsx";
import { businessDayStart } from "@/lib/dates.ts";
import { dateKeyToLocalDate } from "@/lib/pricing.ts";
import { carMainImageUrl } from "@/lib/car-images.ts";

const column_width = 64 // pixels - width of one day column
const row_height = 80 // pixels - height of one car's price row
// Width of the sticky left car info column: 120px on phones, 220px from md up.
// A CSS variable rather than a number so the breakpoint is decided by CSS - no
// window-width state, nothing for SSR and hydration to disagree about.
const car_column_class = '[--car-col:120px] md:[--car-col:220px]'
const car_column_width = 'var(--car-col)'
const days_to_show = 365 // full year


// Cell key is a string that identifies one price cell in the grid
// Format: ${carId}:${dateIndex}
// Example: "3:7" is car with id 3, the column 7 days from today
// Using a string key means O(1) lookup
type CellKey = string

function makeCellKey(carId: number, dateIndex: number): CellKey {
    return `${carId}:${dateIndex}`
}

function parseCellKey(key: CellKey) : { carId: number; dateIndex: number } {
    const parts = key.split(':')
    return {
        carId: Number(parts[0] ?? 0),
        dateIndex: Number(parts[1] ?? 0),
    }
}

// Builds an array of 365 consecutive Date objects starting today
// Plain array, virtualizer doesn't care what's "inside" each
// item, it only needs to know how many there are (its count)
function buildDateRange(days: number): Date[] {
    const today = new Date()
    today.setHours(0, 0, 0, 0) // normalize to midnight so math is clean

    return Array.from({ length: days }, (_, i) => {
        const d = new Date(today) // crucial to have a copy of today rather than mutating it directly
        d.setDate(today.getDate() + i)
        return d
    })
}

function formatDayLabel(date: Date) {
    return {
        weekday: date.toLocaleDateString("en-US", { weekday: "short"}).toUpperCase(),
        dayNum: date.getDate(),
    }
}

export function CalendarGrid({
     cars,
     bookings,
     turoBookings,
     priceOverrides,
     blockedDates,
}: {
    cars: Car[]
    bookings: BookingWithRelations[]
    turoBookings: TuroBooking[]
    priceOverrides: { car_id: number; date: string; price: number }[]
    blockedDates: CarBlockedDate[]
}) {
    const dateRange = buildDateRange(days_to_show)

    // This ref points at the ONE scrollable element that handles both
    // horizontal scrolling (through days) and vertical scrolling (through cars).
    // The virtualizer needs this ref to know which element's scroll position
    // to listen to when deciding which columns are "visible right now".
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    // The horizontal virtualizer — this is the heart of the whole grid.
    // `count`: how many columns exist in total (365)
    // `getScrollElement`: tells the virtualizer which DOM node to watch for scrolling
    // `estimateSize`: the pixel width of every column (fixed here, but could vary per column)
    // `horizontal: true`: tells it to virtualize along the x-axis instead of the default y-axis
    // `overscan`: render a few extra columns just outside the visible area so there's
    //             no flash of empty space if the user scrolls quickly
    const columnVirtualizer = useVirtualizer({
        count: dateRange.length,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: () => column_width,
        horizontal: true,
        overscan: 5,
    })

    // The actual list of columns to render right now - NOT all 365
    // just the ones near the current scroll position
    const virtualColumns = columnVirtualizer.getVirtualItems()

    // The full scrollable width as if all 365 columns existed.
    // This is what makes the scrollbar behave correctly even though
    // most columns aren't actually mounted in the DOM.
    const totalGridWidth = columnVirtualizer.getTotalSize()

    // Month indicator wiring ---------------------
    //  READ direction: `range` (not `getVirtualItems()`) gives the actual
    //  visible range without overscan padding. Its startIndex tells us which
    //  date is currently leftmost-visible, which we use to derive the month
    //  label. This recalculates automatically on every scroll because
    //  useVirtualizer triggers a re-render internally — no manual listener.
    const visibleStartIndex = columnVirtualizer.range?.startIndex ?? 0
    const visibleDate = dateRange[visibleStartIndex] ?? dateRange[0]

    // WRITE direction: given a date picked in the mini calendar, find its
    // index in dateRange and ask the virtualizer to scroll it to the start
    // of the viewport. `align: 'start'` is what makes the clicked date land
    // at the very beginning
    const handleDateSelect = (date: Date) => {
        const targetIndex = dateRange.findIndex(
            (d) =>
                d.getFullYear() === date.getFullYear() &&
                d.getMonth() === date.getMonth() &&
                d.getDate() === date.getDate()
        )
        if (targetIndex !== -1) {
            columnVirtualizer.scrollToIndex(targetIndex, { align: "start"})
        }
    }

    const handleJumpToToday = () => {
        columnVirtualizer.scrollToIndex(0, { align: "start"})
    }

    // --- Booking bar setup ---------------------------------------

    // dateRange[0] is always today at midnight, used as the zero-point
    // for converting any booking date into a column index via direct
    // day-difference math instead of looping with findIndex per booking
    const todayMidnight = dateRange[0] ?? new Date(0)

    // Which column a booking timestamp lands in. The day is resolved in the
    // business's timezone, not the browser's — `.setHours(0,0,0,0)` on the raw
    // instant put a 10pm Central return in the wrong column for any host west of
    // Central, drawing the bar a day short.
    const dateToIndex = useCallback((isoString: string): number => {
        const d = businessDayStart(isoString)
        const diffMs = d.getTime() - todayMidnight.getTime()
        return Math.round(diffMs / (1000 * 60 * 60 * 24))
    }, [todayMidnight])

    // Converts "YYYY-MM-DD" date string to index, so parsed as local midnight, not UTC midnight
    const dateStringToIndex = useCallback((dateStr: string): number => {
        const d = dateKeyToLocalDate(dateStr) ?? new Date(0)
        return Math.round((d.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24))
    }, [todayMidnight])

    // Groups bookings bt car_id once, so each row does a cheap Map lookup instead of filtering
    // the whole bookings array per row. useMemo avoids recomputing this one every render
    // only recalculates when bookings itself changes like after a fresh loader fetch
    const bookingsByCarId = useMemo(() => {
        const map = new Map<number, BookingWithRelations[]>()
        for (const booking of bookings) {
            const existing = map.get(booking.car_id) ?? []
            existing.push(booking)
            map.set(booking.car_id, existing)
        }
        return map
    }, [bookings])

    // Groups Turo trips by car_id, same pattern as bookingsByCarId — kept as its
    // own map/layer since turo_bookings is a separate table/shape (no status,
    // no profiles join, has renter_name/turo_trip_id instead)
    const turoBookingsByCarId = useMemo(() => {
        const map = new Map<number, TuroBooking[]>()
        for (const t of turoBookings) {
            const existing = map.get(t.car_id) ?? []
            existing.push(t)
            map.set(t.car_id, existing)
        }
        return map
    }, [turoBookings])

    // --- Blocked dates ------------
    const [localBlockedState, setLocalBlockedState] = useState<CarBlockedDate[]>([])

    // Tombstones for blocks deleted this session. Filtering localBlockedState
    // alone only ever removed blocks created since page load — anything that
    // arrived from the loader stayed on the grid after a successful delete.
    // A tombstone set covers both sources. Not router.invalidate(): the loader
    // would re-return rows that are also sitting in localBlockedState.
    const [deletedBlockIds, setDeletedBlockIds] = useState<Set<string>>(new Set())

    const allBlockedDates = useMemo(
        () => [...blockedDates, ...localBlockedState].filter(b => !deletedBlockIds.has(b.id)),
        [blockedDates, localBlockedState, deletedBlockIds],
    )

    // carId:dateIndex -> the block covering that day. Ranges are stored as one
    // row with inclusive start/end, so they get expanded per-day here and the
    // cells themselves carry the blocked treatment. The block object is kept
    // rather than a boolean so a cell can show its reason on hover.
    const blockedCellMap = useMemo(() => {
        const map = new Map<CellKey, CarBlockedDate>()
        for (const b of allBlockedDates) {
            const start = Math.max(0, dateStringToIndex(b.start_date))
            const end = Math.min(dateRange.length - 1, dateStringToIndex(b.end_date))
            for (let di = start; di <= end; di++) map.set(makeCellKey(b.car_id, di), b)
        }
        return map
    }, [allBlockedDates, dateStringToIndex, dateRange.length])

    const handleBlocksCreated = useCallback((newBlocks: CarBlockedDate[]) => {
        setLocalBlockedState(prev => [...prev, ...newBlocks])
    }, [])
    const handleBlockDeleted = useCallback((blockId: string) => {
        setDeletedBlockIds(prev => new Set(prev).add(blockId))
    }, [])

    const sharedBoundaryIndices = useMemo(() => {
        const perCarShared = new Map<number, Set<number>>()

        for (const car of cars) {
            const carBookings = bookingsByCarId.get(car.id) ?? []
            const startDates = new Set(carBookings.map(b => dateToIndex(b.start_time)))
            const endDates = new Set(carBookings.map(b => dateToIndex(b.end_time)))
            const shared = new Set<number>()
            for (const endIdx of endDates) {
                if (startDates.has(endIdx)) shared.add(endIdx)
            }
            perCarShared.set(car.id, shared)
        }

        return perCarShared
    }, [bookingsByCarId, cars, dateToIndex])

    // priceOverrideMap
    const [localOverridesState, setLocalOverridesState] = useState<Map<string, number>>(new Map())

    const priceOverrideMap = useMemo(() => {
        const map = new Map<string, number>()
        for (const o of priceOverrides) {
            map.set(`${o.car_id}:${o.date}`, o.price)
        }
        for (const [key, price] of localOverridesState) {
            map.set(key, price)
        }
        return map
    }, [priceOverrides, localOverridesState])

    // getPriceForCell
    // Resolves the displayed price for one cell: override ?? car base price
    // Called during render of every visible cell, must be fast
    const getPriceForCell = (carId: number, basePrice: number, date: Date): number => {
        const dateStr = date.toLocaleDateString("en-CA")
        return priceOverrideMap.get(`${carId}:${dateStr}`) ?? basePrice
    }

    // Return true if this cell has a manually set override price
    // Used to visually distinguish overridden prices
    const hasOverride = (carId: number, date: Date): boolean => {
        const dateStr = date.toLocaleDateString("en-CA")
        return priceOverrideMap.has(`${carId}:${dateStr}`)
    }

    // onPricesUpdated
    // Called by selection panel's prices tab after a successful upsert
    // Merges the newly saved overrides into localOverridesState
    // so the grid re-renders with the new prices immediately
    const handlePricesUpdated = useCallback((
        updates: { carId: number; date: string; price: number }[]
    )=> {
        setLocalOverridesState(prev => {
            const next = new Map(prev)
            for (const u of updates) {
                next.set(`${u.carId}:${u.date}`, u.price)
            }
            return next
        })
    }, [])

    // Selection state

    // the full set of currently selected cell keys
    const [selectedCells, setSelectedCells] = useState<Set<CellKey>>(new Set())

    // the last cell clicked WITHOUT shift held down
    // the start of the shift-click range
    const [anchorCell, setAnchorCell] = useState<CellKey | null>(null)

    // Touch screens have no shift key, so the selection panel offers a "Select
    // range" toggle instead: while it's on, the next tap behaves like a
    // shift-click from the anchor, then it switches itself back off.
    const [rangeMode, setRangeMode] = useState(false)

    // whether the right side panel is visible
    const [panelOpen, setPanelOpen] = useState(false)

    // which of the three panel tabs is showing
    const [activeTab, setActiveTab] = useState<'prices' | 'unavailability' | 'trips'>('prices')

    // Blocking collapses each car's selection to one min→max range, so picking
    // 8/15 and 8/19 also blocks the three days between them. 
    const gapFillCells = useMemo(() => {
        const preview = new Set<CellKey>()
        if (!panelOpen || activeTab !== 'unavailability') return preview

        const spans = new Map<number, { min: number; max: number }>()
        for (const key of selectedCells) {
            const { carId, dateIndex } = parseCellKey(key)
            const existing = spans.get(carId)
            spans.set(carId, existing
                ? { min: Math.min(existing.min, dateIndex), max: Math.max(existing.max, dateIndex) }
                : { min: dateIndex, max: dateIndex })
        }

        for (const [carId, { min, max }] of spans) {
            for (let di = min; di <= max; di++) {
                const key = makeCellKey(carId, di)
                if (!selectedCells.has(key)) preview.add(key)
            }
        }
        return preview
    }, [panelOpen, activeTab, selectedCells])


    // Escape key handler

    // pressing escape clears the entire selection and closes the panel

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && selectedCells.size > 0) {
                setSelectedCells(new Set())
                setAnchorCell(null)
                setPanelOpen(false)
                setRangeMode(false)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [selectedCells.size])

    // Shift-click rectangular selection

    const handleShiftClick = useCallback((targetCarId: number, targetDateIndex: number) => {
        if (!anchorCell) return

        const { carId: anchorCarId, dateIndex: anchorDateIndex } = parseCellKey(anchorCell)

        const anchorCarIndex = cars.findIndex(c => c.id === anchorCarId)
        const targetCarIndex = cars.findIndex(c => c.id === targetCarId)

        // Build the min/max bounds of the rectangle in both dimensions
        const minCarIndex = Math.min(anchorCarIndex, targetCarIndex)
        const maxCarIndex = Math.max(anchorCarIndex, targetCarIndex)
        const minDateIndex = Math.min(anchorDateIndex, targetDateIndex)
        const maxDateIndex = Math.max(anchorDateIndex, targetDateIndex)

        // Build a fresh Set containing every cell key inside the rectangle
        const next = new Set<CellKey>()
        for (let ci = minCarIndex; ci <= maxCarIndex; ci++) {
            for (let di = minDateIndex; di <= maxDateIndex; di++) {
                // cars[ci] is safe because ci is bounded by findIndex results
                // which are always valid indices into the cars array
                next.add(makeCellKey(cars[ci]!.id, di))
            }
        }

        setSelectedCells(next)
        setPanelOpen(next.size > 0)
    }, [anchorCell, cars])

    // Price cell click handler
    // Three behaviors

    // 1. Shift+click -> extend selection from anchor
    // 2. Click on selected cell -> deselect it
    // also close panel if empties the selection
    // 3. Click on an unselected cell -> clear everything and select only
    // this cell.

    const handleCellClick = useCallback((carId: number, dateIndex: number, e: React.MouseEvent) => {
        // Prevent the click from bubbling up to the scroll container
        e.stopPropagation()

        if ((e.shiftKey || rangeMode) && anchorCell) {
            handleShiftClick(carId, dateIndex)
            setRangeMode(false)
            return
        }

        const key = makeCellKey(carId, dateIndex)

        setSelectedCells(prev => {
            const next = new Set(prev)

            if (next.has(key)) {
                // Toggle off: remove this cell from selection
                next.delete(key)
                if (next.size === 0) {
                    // Selection is now empty, close panel
                    setPanelOpen(false)
                }
            } else {
                // Plain click on unselected cell: reset and select only this one
                // next.clear() only have this if each time a new cell is selected, clears the previous
                next.add(key)
                setPanelOpen(true)
                //setActiveTab('prices') // Only have this to set active tab to prices after every close or change
            }

            return next
        })

        // Update anchor on every non-shift click so future shift-clicks extend from here
        setAnchorCell(key)
    }, [anchorCell, rangeMode, handleShiftClick])

    // Column header click handler
        // Clicking a date header selects the entire column
    const handleColumnHeaderClick = useCallback((dateIndex: number, e: React.MouseEvent) => {
        e.stopPropagation()

        if ((e.shiftKey || rangeMode) && anchorCell) {
            setRangeMode(false)
            const { dateIndex: anchorDateIndex } = parseCellKey(anchorCell)
            const minDateIndex = Math.min(anchorDateIndex, dateIndex)
            const maxDateIndex = Math.max(anchorDateIndex, dateIndex)

            // Select ALL cars for every date in the range
            const next = new Set<CellKey>(selectedCells)
            for (const car of cars) {
                for (let di = minDateIndex; di <= maxDateIndex; di++) {
                    next.add(makeCellKey(car.id, di))
                }
            }

            setSelectedCells(next)
            setPanelOpen(next.size > 0)
            return
        }

        // Check if every car cell in this column is already selected
        const columnKeys = cars.map(car=> makeCellKey(car.id, dateIndex))
        const isFullySelected = columnKeys.every(key => selectedCells.has(key))

        if (isFullySelected) {
            // Toggle off: remove this column's cells from selection
            const next = new Set<CellKey>(selectedCells)
            for (const key of columnKeys) next.delete(key)
            setSelectedCells(next)
            setPanelOpen(next.size > 0)
            setAnchorCell(null)
        } else {
            // Add this column to whatever is already selected
            const next = new Set<CellKey>(selectedCells)
            for (const key of columnKeys) next.add(key)
            setSelectedCells(next)
            setPanelOpen(true)
            // setActiveTab('prices')
            if (cars.length > 0) {
                setAnchorCell(makeCellKey(cars[0]!.id, dateIndex))
            }
        }
    }, [anchorCell, rangeMode, cars, selectedCells])


    // Derived selection info
        // Count how many unique dates and cars are in the selection ("update N dates")
        // useMemo avoids recomputing on every render, only when selectedCells changes

    const selectionInfo = useMemo(() => {
        const dateIndices = new Set<number>()
        const carIds = new Set<number>()

        for (const key of selectedCells) {
            const { carId, dateIndex } = parseCellKey(key)
            dateIndices.add(dateIndex)
            carIds.add(carId)
        }

        return {
            totalCells: selectedCells.size,
            uniqueDates: dateIndices.size,
            uniqueCars: carIds.size,
        }
    }, [selectedCells])

    const handleClosePanel = useCallback(() => {
        setSelectedCells(new Set())
        setAnchorCell(null)
        setPanelOpen(false)
        setRangeMode(false)
    }, [])

    return (
        <div className={`flex-1 min-h-0 flex flex-col border border-gray-200 bg-white ${car_column_class}`}>
            {/*
                The single scroll container. overflow-auto enables BOTH horizontal
                and vertical scrolling within this one element. Everything sticky
                (the header row, the car-name column) is positioned relative to
                this container's scroll, not the page's scroll - which is why it
                has to fill a bounded height (flex-1 min-h-0) rather than grow
                with its rows, or the page scrolls instead and the header leaves.
            */}
            <div
                ref={scrollContainerRef}
                className="relative flex-1 min-h-0 overflow-auto overscroll-contain"
            >
                {/*
                    This inner div's width is set to the car-info column plus the
                    FULL virtual grid width. It exists purely so the browser knows
                    how far there is to scroll horizontally — the actual visible
                    content inside it is positioned with absolute offsets.
                */}
                <div
                    className="relative"
                    style={{ width: `calc(${car_column_width} + ${totalGridWidth}px)` }}
                >
                    {/* ── HEADER ROW — sticky to the top ──────────────────────── */}
                    <div
                        className="sticky top-0 z-20 flex bg-white border-b border-gray-200"
                        style={{ height: 80}}
                    >
                        {/* Top-left corner cell — sticky in BOTH directions, sits
                            above everything else (highest z-index) since it has
                            to stay fixed no matter which way the user scrolls. */}
                        <div
                            className="sticky left-0 z-30 bg-white border-r border-gray-200 flex items-center px-2 md:px-4 text-xs text-gray-500"
                            style={{ width: car_column_width, flexShrink: 0 }}
                        >
                            <MonthPicker
                                currentDate={visibleDate}
                                onSelectDate={handleDateSelect}
                                onJumpToToday={handleJumpToToday}
                            />
                        </div>

                        {/* Date column headers */}
                        <div className="relative" style={{ width: totalGridWidth }}>
                            {virtualColumns.map((virtualColumn) => {
                                const date = dateRange[virtualColumn.index]
                                const { weekday, dayNum } = formatDayLabel(date)
                                const isWeekend = date?.getDay() === 0 || date?.getDay() === 6
                                const isToday = virtualColumn.index === 0

                                // A column is "active" when every car has this dateIndex in selectedCells
                                const isColumnSelected = cars.length > 0 && cars.every(
                                    car => selectedCells.has(makeCellKey(car.id, virtualColumn.index))
                                )

                                return (
                                    <div
                                        key={virtualColumn.key}
                                        onClick={(e) => handleColumnHeaderClick(virtualColumn.index, e)}
                                        className={[
                                            'absolute top-0 h-full flex flex-col items-center justify-center text-xs',
                                            'cursor-pointer select-none',
                                            isColumnSelected
                                                ? 'bg-[#b2e0d1]'
                                                : isWeekend
                                                    ? 'bg-gray-100 hover:bg-gray-200'
                                                    : 'hover:bg-gray-50'
                                        ].join(' ')}
                                        style={{
                                            left: virtualColumn.start,
                                            width: virtualColumn.size,
                                        }}
                                    >
                                        <span className={isColumnSelected ? 'text-emerald-700' : 'text-gray-400'}>
                                            {weekday}
                                        </span>
                                        <span
                                            className={[
                                                'mt-4',
                                                isToday
                                                    ? "w-6 h-6 rounded-full bg-emerald-700 text-white flex items-center justify-center"
                                                    : isColumnSelected
                                                        ? 'text-emerald-700 font-semibold'
                                                        : "text-gray-800"
                                            ].join(' ')}
                                        >
                                            {dayNum}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>


                    {/* ── CAR ROWS ─────────────────────────────────────────────── */}
                    {cars.map((car) => {
                        const carBookings = bookingsByCarId.get(car.id) ?? []
                        const carTuro = turoBookingsByCarId.get(car.id) ?? []
                        const isCarRowSelected = [...selectedCells].some(
                            key => parseCellKey(key).carId === car.id
                        )
                        const carSharedBoundaries = sharedBoundaryIndices.get(car.id) ?? new Set<number>()

                        return (
                            <div key={car.id} className="relative flex border-b border-gray-100" style={{height: row_height}}>
                                {/* Sticky left column - car info, fixed horizontally */}
                                <div
                                    className={[
                                        'sticky left-0 z-10 border-r border-gray-200 flex items-center px-2 md:px-4 text-xs',
                                        isCarRowSelected
                                            ? 'bg-[#b2e0d1] text-gray-800' // #b2e0d1 is the same as emerald-600/30
                                            : 'bg-white text-gray-800',
                                    ].join(' ')}
                                    style={{width: car_column_width, flexShrink: 0}}
                                >
                                    <div className="flex flex-row gap-4 items-center min-w-0">
                                        {/* No room for the photo in the phone-width column */}
                                        <img
                                            src={carMainImageUrl(car.id)}
                                            alt={`${car.year} ${car.make} ${car.model}`}
                                            className="hidden md:block w-12 h-8 object-cover rounded-sm flex-shrink-0"
                                            loading="lazy"
                                            decoding="async"
                                        />
                                        <div className="flex flex-col text-left min-w-0">
                                            <p className="text-xs text-black mt-1">{car.make} {car.model} {car.year}</p>
                                            <p className="text-xs text-gray-600">{car.license_plate}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="relative" style={{width: totalGridWidth}}>

                                    {/* ---- Layer 1: Price cells ----------------- */}
                                    {virtualColumns.map((virtualColumn) => {
                                        const date = dateRange[virtualColumn.index]
                                        const isWeekend = date?.getDay() === 0 || date?.getDay() === 6
                                        // Is this cell selected?
                                        const isSelected = selectedCells.has(
                                            makeCellKey(car.id, virtualColumn.index)
                                        )

                                        const resolvedPrice = date ? getPriceForCell(car.id, car.price_per_day, date) : car.price_per_day
                                        const isOverridden = date ? hasOverride(car.id, date) : false

                                        const cellKey = makeCellKey(car.id, virtualColumn.index)
                                        const block = blockedCellMap.get(cellKey)
                                        const isGapFill = gapFillCells.has(cellKey)

                                        return (
                                            <div
                                                key={virtualColumn.key}
                                                onClick={(e) => handleCellClick(car.id, virtualColumn.index, e)}
                                                title={block ? (block.reason ?? 'Blocked') : undefined}
                                                className={[
                                                    'absolute top-0 h-full',
                                                    'text-sm border-r border-gray-200',
                                                    // A blocked day centers its ✕; a priced day keeps the price
                                                    // sitting on the baseline where it always was.
                                                    block ? 'flex items-center justify-center' : 'flex items-end justify-center pb-1',
                                                    // select-none prevents the browser from highlighting text content during shift-click drag operations
                                                    'cursor-pointer select-none',
                                                    // Selection state drives background and text color.
                                                    // Unselected weekends keep their gray tint.
                                                    // Unselected weekdays get a subtle hover state.
                                                    isSelected
                                                        ? 'bg-[#b2e0d1] text-emerald-800'
                                                        : isWeekend
                                                            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                            : 'text-gray-700 hover:bg-gray-50',
                                                ].join(' ')}
                                                style={{
                                                    left: virtualColumn.start,
                                                    width: virtualColumn.size,
                                                }}
                                            >
                                                {/* Blocked days are drawn as the cell itself rather than as a
                                                    bar across it, so a one-day block is exactly as legible as a
                                                    ten-day one. Selection background wins over the hatch, but
                                                    the ✕ stays on top either way — otherwise a block would
                                                    disappear the moment you selected it to remove it. */}
                                                {block && !isSelected && (
                                                    <div
                                                        className="absolute inset-0 pointer-events-none"
                                                        style={{
                                                            backgroundImage:
                                                                'repeating-linear-gradient(45deg, rgba(107,114,128,0.16) 0px, rgba(107,114,128,0.16) 2px, transparent 2px, transparent 6px)',
                                                        }}
                                                    />
                                                )}

                                                {/* Days that a min→max block would swallow but that aren't
                                                    selected yet. Dashed, so they read as "about to happen"
                                                    rather than as either selected or already blocked. */}
                                                {isGapFill && !block && (
                                                    <div className="absolute inset-0.5 pointer-events-none rounded-sm border border-dashed border-emerald-500/70 bg-emerald-500/10" />
                                                )}

                                                {block ? (
                                                    <X size={14} className="relative text-gray-500" strokeWidth={2.5} />
                                                ) : (
                                                    <span className={isOverridden && !isSelected ? 'relative text-amber-600' : 'relative'}>
                                                        ${Math.floor(resolvedPrice)}
                                                    </span>
                                                )}
                                            </div>
                                        )
                                    })}

                                    {/* Layer 2: bookings bars: ONE element per booking, not per cell.*/}
                                    {carBookings.map((booking) => {
                                        const rawStart = dateToIndex(booking.start_time)
                                        const rawEnd = dateToIndex(booking.end_time)

                                        const startIndex = Math.max(0, rawStart)
                                        const endIndex = Math.min(dateRange.length - 1, rawEnd)

                                        if (rawEnd < 0 || rawStart > dateRange.length - 1) return null

                                        const isClampedAtStart = rawStart < 0
                                        const isClampedAtEnd = rawEnd > dateRange.length - 1

                                        const left = isClampedAtStart ? 0 : startIndex * column_width + column_width / 2
                                        const rightEdge = isClampedAtEnd ? dateRange.length * column_width : endIndex * column_width + column_width / 2
                                        const width = rightEdge - left

                                        const startIsShared = carSharedBoundaries.has(rawStart)
                                        const endIsShared = carSharedBoundaries.has(rawEnd)

                                        return (
                                            <div
                                                key={booking.id}
                                                className="absolute pointer-events-none z-5"
                                                style={{
                                                    left,
                                                    width,
                                                    top: row_height / 2 - 1,
                                                    height: 2,
                                                }}
                                            >
                                                {/* The line itself */}
                                                <div className="absolute inset-0 bg-black rounded-full"/>

                                                {!isClampedAtStart && (
                                                    // Start dot
                                                    <div
                                                        className="absolute -left-0.5 -top-[3px] w-2 h-2 rounded-full bg-black"
                                                        style={{ left: startIsShared ? 0.1 : -2 }}
                                                    />
                                                )}

                                                {!isClampedAtEnd && (
                                                    <div
                                                        // End dot
                                                        className="absolute -top-[3px] w-2 h-2 rounded-full bg-black"
                                                        style={{ right: endIsShared ? 0.1 : -2 }}
                                                    />
                                                )}
                                            </div>
                                        )
                                    })}

                                    {/* Blocked dates used to be a third bar layer here, drawn from the
                                        center of the start cell to the center of the end cell. A one-day
                                        block made that zero pixels wide and stacked its two end dots on
                                        top of each other. They're rendered as the price cells themselves
                                        now (Layer 1), which can't collapse and reads unambiguously. */}

                                    {/* Layer 3: Turo booking bars – violet, own track below the booking line */}
                                    {carTuro.map((trip) => {
                                        const rawStart = dateToIndex(trip.start_time)
                                        const rawEnd = dateToIndex(trip.end_time)
                                        const startIndex = Math.max(0, rawStart)
                                        const endIndex = Math.min(dateRange.length - 1, rawEnd)
                                        if (rawEnd < 0 || rawStart > dateRange.length - 1) return null
                                        const isClampedAtStart = rawStart < 0
                                        const isClampedAtEnd = rawEnd > dateRange.length - 1
                                        const left = isClampedAtStart ? 0 : startIndex * column_width + column_width / 2
                                        const rightEdge = isClampedAtEnd ? dateRange.length * column_width : endIndex * column_width + column_width / 2
                                        const width = rightEdge - left

                                        return (
                                            <div key={trip.id} className="absolute pointer-events-none z-6"
                                                 style={{ left, width, top: row_height / 2 + 6, height: 2 }}>
                                                <div className="absolute inset-0 bg-violet-500 rounded-full" />
                                                {!isClampedAtStart && <div className="absolute -top-[3px] w-2 h-2 rounded-full bg-violet-500" style={{ left: -2 }} />}
                                                {!isClampedAtEnd && <div className="absolute -top-[3px] w-2 h-2 rounded-full bg-violet-500" style={{ right: -2 }} />}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </div>

            </div>
            {panelOpen && (
                <SelectionPanel
                    selectionInfo={selectionInfo}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    onClose={handleClosePanel}
                    rangeMode={rangeMode}
                    setRangeMode={setRangeMode}
                    selectedCells={selectedCells}
                    bookings={bookings}
                    turoBookings={turoBookings}
                    cars={cars}
                    dateRange={dateRange}
                    dateToIndex={dateToIndex}
                    priceOverrideMap={priceOverrideMap}
                    onPricesUpdated={handlePricesUpdated}
                    blockedDates={allBlockedDates}
                    onBlocksCreated={handleBlocksCreated}
                    onBlockDeleted={handleBlockDeleted}
                />
            )}
        </div>
    )
}