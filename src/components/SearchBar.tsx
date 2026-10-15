import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, Search } from 'lucide-react'
import { TripCalendar } from '@/components/TripCalendar.tsx'
import { businessTimeSlots, earliestStartMinutesToday } from '@/lib/availability.ts'
import type { RangeFocus } from '@/lib/date-range.ts'
import {
    dateKeyToLocalDate,
    getTripDurationMinutes,
    timeToMinutes,
    toDateKey,
    todayInBusinessTz,
} from '@/lib/pricing.ts'
import { cn } from '@/lib/utils.ts'

// What a caller may hand us as a starting value. Dates arrive from the URL as
// 'YYYY-MM-DD' keys, so strings are accepted alongside real Dates; times are
// 'H:mm' slots, already validated by the route.
export type SearchBarInitial = {
    start?: Date | string | null
    end?: Date | string | null
    startTime?: string
    endTime?: string
}

function coerceDate(v: Date | string | null | undefined): Date | null {
    if (!v) return null
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v
    // Strings are 'YYYY-MM-DD' keys from the URL. Anything else is rejected
    // rather than guessed at — `new Date(str)` on a full ISO instant would
    // parse as UTC and land on the previous day west of Greenwich.
    return dateKeyToLocalDate(v)
}

// Pinned locale: the fleet page feeds `initial` during SSR, so an unpinned
// toLocaleDateString would format with Node's default locale on the server and
// the browser's on the client — a React hydration mismatch.
function formatTriggerDate(d: Date) {
    return d.toLocaleDateString('en-US')
}

// The car page refuses anything shorter, so the bar doesn't offer it.
const MIN_TRIP_MINUTES = 24 * 60

const SLOTS = businessTimeSlots()
const slotLabel = (value: string) => SLOTS.find(s => s.value === value)?.label

// Which popover is open. One value, so the calendar and the two time lists can
// never be open together.
type OpenPanel = 'dates' | 'startTime' | 'endTime' | null

export function SearchBar({
                              initial,
                              className = '',
                              onCalendarOpenChange,
                          }: {
    initial?: SearchBarInitial
    className?: string
    /** The homepage slides the bar up while the calendar is open, to make room for it. */
    onCalendarOpenChange?: (open: boolean) => void
}) {
    const navigate = useNavigate()

    const [start, setStart] = useState<Date | null>(coerceDate(initial?.start))
    const [end, setEnd] = useState<Date | null>(coerceDate(initial?.end))
    // '' until chosen, the car page's convention. Times are optional: a search
    // needs only the dates, and a time narrows it when given.
    const [startTime, setStartTime] = useState(initial?.startTime ?? '')
    const [endTime, setEndTime] = useState(initial?.endTime ?? '')
    const [open, setOpen] = useState<OpenPanel>(null)
    // Which end of the range the next calendar click sets: the field the
    // calendar was opened from, then whichever end is still owed.
    const [focus, setFocus] = useState<RangeFocus>('start')

    const canSearch = !!start && !!end

    // The whole bar counts as the calendar's trigger, so moving between From
    // and Until (or onto a time) isn't an outside click that closes it.
    const barRef = useRef<HTMLDivElement>(null)

    // Stable so TripCalendar's listener effect doesn't resubscribe each render.
    const closeCalendar = useCallback(() => setOpen(cur => (cur === 'dates' ? null : cur)), [])

    function toggleDates(field: RangeFocus) {
        if (open === 'dates' && focus === field) {
            setOpen(null)
            return
        }
        // Until with no From yet still picks the start first, so highlight
        // the field the click will actually fill.
        setFocus(field === 'end' && !start ? 'start' : field)
        setOpen('dates')
    }

    // ── Time rules ───────────────────────────────────────────────────────────
    // The same two the car page applies before it will price a trip: no start
    // inside today's lead time, and nothing under 24 hours.
    const startKey = start ? toDateKey(start) : null
    const endKey = end ? toDateKey(end) : null

    const startBlocked = useCallback((value: string) => {
        if (!startKey) return false
        const now = new Date()
        if (startKey !== todayInBusinessTz(now)) return false
        const floor = earliestStartMinutesToday(now)
        return floor === null || timeToMinutes(value) < floor
    }, [startKey])

    const tooShort = useCallback((from: string, to: string) => {
        if (!startKey || !endKey || !from || !to) return false
        return getTripDurationMinutes(startKey, from, endKey, to) < MIN_TRIP_MINUTES
    }, [startKey, endKey])

    const startOptions = useMemo(
        () => SLOTS.map(s => ({ ...s, disabled: startBlocked(s.value) || tooShort(s.value, endTime) })),
        [startBlocked, tooShort, endTime],
    )
    const endOptions = useMemo(
        () => SLOTS.map(s => ({ ...s, disabled: tooShort(startTime, s.value) })),
        [tooShort, startTime],
    )

    // A date change can strand a chosen time (pick 10:00 AM, then move the
    // start to today). It's cleared rather than snapped to the nearest slot:
    // every time shown is one the guest chose. When the trip comes out too
    // short it's the end that goes, since the end follows the start.
    useEffect(() => {
        const keptStart = startTime && startBlocked(startTime) ? '' : startTime
        if (keptStart !== startTime) setStartTime(keptStart)
        if (endTime && tooShort(keptStart, endTime)) setEndTime('')
    }, [startTime, endTime, startBlocked, tooShort])

    function chooseStartTime(value: string) {
        setStartTime(value)
        // Same hand-off as the car page: the end time is next while it's owed.
        setOpen(value && !endTime ? 'endTime' : null)
    }

    function reset() {
        setStart(null)
        setEnd(null)
        setStartTime('')
        setEndTime('')
        setFocus('start')
    }

    function handleSearch() {
        if (!start || !end) return
        setOpen(null)
        // Navigate with URL as the source of truth. Bare 'YYYY-MM-DD' keys
        // rather than toISOString(): a full UTC instant shifts the calendar day
        // by one for anyone west of Greenwich, and the car page has to read
        // these back as the days the customer actually clicked.
        navigate({
            to: '/fleet',
            search: () => ({
                start: toDateKey(start),
                end: toDateKey(end),
                startTime: startTime || undefined,
                endTime: endTime || undefined,
            }),
        })
    }

    const datesOpen = open === 'dates'

    // After TripCalendar's own layout pass, so the panel is placed first and
    // re-places itself once the page has finished moving the bar.
    useEffect(() => {
        onCalendarOpenChange?.(datesOpen)
    }, [datesOpen, onCalendarOpenChange])

    return (
        <div
            ref={barRef}
            className={cn(
                // text-ink is explicit because this also sits on the homepage video,
                // where the surrounding copy is white.
                // text-left for the same reason: on phones the homepage hero
                // centres its text, and text alignment is inherited.
                'relative w-full max-w-3xl mx-auto bg-surface text-ink text-left shadow-lg border border-line',
                // Phones: a stacked card, From and Until on their own rows
                'flex flex-col rounded-3xl',
                'sm:flex-row sm:items-stretch sm:rounded-full sm:h-16',
                className,
            )}
            role="search"
            aria-label="Trip search"
        >
            <SearchField
                label="From"
                date={start}
                dateActive={datesOpen && focus === 'start'}
                onDateClick={() => toggleDates('start')}
                time={startTime}
                timeOpen={open === 'startTime'}
                onTimeOpenChange={o => setOpen(cur => (o ? 'startTime' : cur === 'startTime' ? null : cur))}
                timeOptions={startOptions}
                onTimeChange={chooseStartTime}
            />

            <SearchField
                label="Until"
                className="border-t border-line sm:border-t-0 sm:border-l"
                date={end}
                dateActive={datesOpen && focus === 'end'}
                onDateClick={() => toggleDates('end')}
                time={endTime}
                timeOpen={open === 'endTime'}
                onTimeOpenChange={o => setOpen(cur => (o ? 'endTime' : cur === 'endTime' ? null : cur))}
                timeOptions={endOptions}
                onTimeChange={value => { setEndTime(value); setOpen(null) }}
            />

            <TripCalendar
                mode="range"
                numberOfMonths={2}
                open={datesOpen}
                onClose={closeCalendar}
                triggerRef={barRef}
                startDate={start ?? undefined}
                endDate={end ?? undefined}
                focus={focus}
                onSelectRange={(range, nextFocus) => {
                    setStart(range.start ?? null)
                    setEnd(range.end ?? null)
                    setFocus(nextFocus)
                }}
                // Stretched across the whole bar, under it.
                className="right-0 mt-3 z-50"
                footer={
                    <>
                        <button
                            type="button"
                            className="text-sm font-medium px-4 py-2 rounded-full text-muted hover:text-ink cursor-pointer"
                            onClick={reset}
                        >
                            Reset
                        </button>
                        <button
                            type="button"
                            className="text-sm font-semibold px-5 py-2 rounded-full bg-brand text-on-brand hover:bg-pine-800 cursor-pointer"
                            onClick={closeCalendar}
                        >
                            Save
                        </button>
                    </>
                }
            />

            {/* Search */}
            {/* Phones get a full-width labelled button, since an icon alone is a
                small tap target and doesn't say what it does. From sm up it's a
                round icon, and the label becomes screen-reader-only
                (sm:sr-only), so the button keeps its accessible name either way. */}
            <div className="p-2 border-t border-line sm:border-t-0 sm:p-0 sm:pr-2 sm:pl-1 flex items-center justify-center">
                <button
                    type="button"
                    disabled={!canSearch}
                    onClick={handleSearch}
                    className={cn(
                        'h-12 w-full gap-2 font-semibold sm:w-12 rounded-full flex items-center justify-center transition-transform shadow-md',
                        // Near-white text on the
                        // light disabled fill was barely readable.
                        canSearch
                            ? 'bg-brand text-on-brand hover:bg-pine-800 hover:scale-101 cursor-pointer'
                            : 'bg-cream-300 text-muted cursor-not-allowed',
                    )}
                >
                    <Search size={18} strokeWidth={2.5} />
                    <span className="sm:sr-only">Search</span>
                </button>
            </div>
        </div>
    )
}

type TimeOption = { value: string; label: string; disabled: boolean }

// One end of the trip: its label, a date button and a time button. The label
// sits inside the date button so the whole column is one target; the time
// button carries an invisible copy of it, so both values line up.
function SearchField({
    label,
    className,
    date,
    dateActive,
    onDateClick,
    time,
    timeOpen,
    onTimeOpenChange,
    timeOptions,
    onTimeChange,
}: {
    label: string
    className?: string
    date: Date | null
    dateActive: boolean
    onDateClick: () => void
    time: string
    timeOpen: boolean
    onTimeOpenChange: (open: boolean) => void
    timeOptions: TimeOption[]
    onTimeChange: (value: string) => void
}) {
    return (
        <div className={cn('flex min-w-0 flex-1 items-stretch gap-1 p-1.5 h-16 sm:h-full', className)}>
            <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={dateActive}
                onClick={onDateClick}
                className={cn(
                    'min-w-0 flex-1 rounded-full pl-5 pr-3 flex items-center justify-between gap-2 text-left cursor-pointer transition-colors',
                    dateActive ? 'bg-subtle' : 'hover:bg-subtle',
                )}
            >
                <span className="min-w-0 flex flex-col">
                    <span className="text-[12px] font-semibold tracking-wide">{label}</span>
                    <span className={cn('text-[15px] truncate', date ? 'text-ink' : 'text-muted')}>
                        {date ? formatTriggerDate(date) : 'Add dates'}
                    </span>
                </span>
                <ChevronDown size={14} className="shrink-0 text-muted" />
            </button>

            <TimeSelect
                label={`${label} time`}
                value={time}
                options={timeOptions}
                open={timeOpen}
                onOpenChange={onTimeOpenChange}
                onChange={onTimeChange}
            />
        </div>
    )
}

// A borderless cousin of the car page's TimeDropdown, plus an "Any time" row,
// since a time here is optional and choosing one shouldn't be a one-way door.
function TimeSelect({
    label,
    value,
    options,
    open,
    onOpenChange,
    onChange,
}: {
    label: string
    value: string
    options: TimeOption[]
    open: boolean
    onOpenChange: (open: boolean) => void
    onChange: (value: string) => void
}) {
    const ref = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    // `mousedown`, like TripCalendar: when choosing a start time opens the end
    // list, that mousedown is over before this listener attaches.
    useEffect(() => {
        if (!open) return
        function onDocumentMouseDown(e: MouseEvent) {
            if (!ref.current?.contains(e.target as Node)) onOpenChange(false)
        }
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') onOpenChange(false)
        }
        document.addEventListener('mousedown', onDocumentMouseDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('mousedown', onDocumentMouseDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [open, onOpenChange])

    // Centre the chosen slot (or the first one on offer) by setting the list's
    // own scrollTop. scrollIntoView would scroll the window too.
    useEffect(() => {
        const list = listRef.current
        if (!open || !list) return
        const target =
            list.querySelector<HTMLElement>('[data-selected="true"]')
            ?? list.querySelector<HTMLElement>('[data-slot][data-disabled="false"]')
        if (target) list.scrollTop = target.offsetTop - (list.clientHeight - target.offsetHeight) / 2
    }, [open])

    const chosen = value ? options.find(o => o.value === value)?.label ?? slotLabel(value) : undefined

    return (
        <div ref={ref} className="relative shrink-0 w-[8.5rem] sm:w-32">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={chosen ? `${label}: ${chosen}` : `${label} (optional)`}
                onClick={() => onOpenChange(!open)}
                className={cn(
                    'h-full w-full rounded-full pl-4 pr-3 flex items-center justify-between gap-2 text-left cursor-pointer transition-colors',
                    open ? 'bg-subtle' : 'hover:bg-subtle',
                )}
            >
                <span className="min-w-0 flex flex-col">
                    <span aria-hidden="true" className="text-[12px] invisible">&nbsp;</span>
                    <span className={cn('text-[15px] whitespace-nowrap', chosen ? 'text-ink' : 'text-muted')}>
                        {chosen ?? 'Add time'}
                    </span>
                </span>
                <ChevronDown size={14} className={cn('shrink-0 text-muted transition-transform duration-150', open && 'rotate-180')} />
            </button>

            {open && (
                <div
                    ref={listRef}
                    role="listbox"
                    aria-label={label}
                    className="absolute top-full right-0 mt-2 z-[120] w-40 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface py-1 shadow-xl time-dropdown-scroll"
                >
                    <button
                        type="button"
                        role="option"
                        aria-selected={value === ''}
                        data-selected={value === '' ? 'true' : 'false'}
                        onClick={() => { onOpenChange(false); onChange('') }}
                        className={cn(
                            'w-full text-left px-4 py-2 text-sm text-muted cursor-pointer hover:bg-subtle',
                            value === '' && 'font-semibold',
                        )}
                    >
                        Any time
                    </button>
                    {options.map(opt => (
                        <button
                            key={opt.value}
                            type="button"
                            role="option"
                            aria-selected={opt.value === value}
                            aria-disabled={opt.disabled}
                            data-slot
                            data-selected={opt.value === value ? 'true' : 'false'}
                            data-disabled={opt.disabled ? 'true' : 'false'}
                            onClick={() => {
                                // Close before onChange, so a caller that opens
                                // the other list in onChange isn't overridden.
                                if (!opt.disabled) { onOpenChange(false); onChange(opt.value) }
                            }}
                            className={cn(
                                'w-full text-left px-4 py-2 text-sm',
                                opt.disabled
                                    ? 'text-ink-400 cursor-not-allowed'
                                    : opt.value === value
                                        ? 'bg-subtle font-semibold cursor-pointer'
                                        : 'hover:bg-subtle cursor-pointer',
                            )}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
