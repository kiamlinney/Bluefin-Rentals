import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { Search, ChevronDown, MapPin } from 'lucide-react'

export type LocationCode = 'MSP' | 'stpaul-mpls'

export type SearchBarValue = {
    location: LocationCode
    start?: Date | null
    end?: Date | null
}

const LOCATIONS: { value: LocationCode; label: string; section: 'Airports' | 'Cities' }[] = [
    { value: 'MSP', label: 'MSP – Minneapolis–Saint Paul International Airport', section: 'Airports' },
    { value: 'stpaul-mpls', label: 'Minneapolis–St Paul (metro)', section: 'Cities' },
]

const calendarClassNames = {
    root: 'p-0 font-sans',
    months: 'flex flex-col',
    month: 'space-y-3',
    month_caption: 'flex justify-center items-center h-9 relative',
    caption_label: 'text-sm font-semibold text-gray-800 tracking-wide',
    nav: 'w-full flex items-center justify-center relative h-5',
    button_previous: 'absolute left-2 top-0 w-7 h-7 rounded-md border border-gray-800 inline-flex items-center justify-center bg-transparent hover:bg-gray-100 transition-colors cursor-pointer',
    button_next: 'absolute right-2 top-0 w-7 h-7 rounded-md border border-gray-800 inline-flex items-center justify-center bg-transparent hover:bg-gray-100 transition-colors cursor-pointer',
    month_grid: 'w-full border-collapse',
    weekdays: 'flex',
    weekday: 'w-9 text-center text-[10px] font-medium text-black uppercase tracking-widest pb-1',
    week: 'flex mt-1',
    day: 'w-9 h-9 text-center text-sm p-0',

    day_button: 'w-9 h-9 text-sm font-medium text-black hover:bg-gray-200 hover:rounded-full transition-colors focus:outline-none cursor-pointer rounded-none',

    today:'[&>button]:underline',

    selected: '[&>button]:bg-emerald-800 [&>button]:text-white',

    // Range styling for a seamless pill
    range_start: '[&>button]:rounded-l-full [&>button]:bg-emerald-800 [&>button]:text-white',
    range_middle: '[&>button]:rounded-none  [&>button]:bg-emerald-700/90 [&>button]:text-white',
    range_end:   '[&>button]:rounded-r-full [&>button]:bg-emerald-800 [&>button]:text-white',

    disabled: '[&>button]:text-gray-300 [&>button]:cursor-not-allowed [&>button]:hover:bg-transparent',
    outside: '[&>button]:text-gray-400 [&>button]:opacity-50',
    hidden: 'invisible',
}

function toIso(d: Date) {
    return new Date(d).toISOString()
}

function coerceDate(v: Date | string | null | undefined): Date | null {
    if (!v) return null
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}

export function SearchBar({
                              initial,
                              onSubmit,
                              className = '',
                          }: {
    initial?: Partial<SearchBarValue>
    onSubmit?: (v: Required<SearchBarValue>) => void
    className?: string
}) {
    const navigate = useNavigate()

    // Value state (stable codes for location)
    const [location, setLocation] = useState<LocationCode>(
        (initial?.location as LocationCode) ?? 'MSP',
    )
    const [start, setStart] = useState<Date | null>(coerceDate(initial?.start))
    const [end, setEnd] = useState<Date | null>(coerceDate(initial?.end))

    // Popover state
    const [openLocation, setOpenLocation] = useState(false)
    const [openCalendar, setOpenCalendar] = useState(false)

    const canSearch = useMemo(() => !!start && !!end, [start, end])

    // Close popovers on outside click or Escape
    const locRef = useRef<HTMLDivElement>(null)
    const calRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            const t = e.target as Node
            if (openLocation && locRef.current && !locRef.current.contains(t)) setOpenLocation(false)
            if (openCalendar && calRef.current && !calRef.current.contains(t)) setOpenCalendar(false)
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                setOpenLocation(false)
                setOpenCalendar(false)
            }
        }
        document.addEventListener('mousedown', onDocClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDocClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [openLocation, openCalendar])

    function handleSearch() {
        if (!start || !end) return
        const payload: Required<SearchBarValue> = {
            location,
            start,
            end,
        }
        // Navigate with URL as the source of truth
        navigate({
            to: '/fleet',
            search: () => ({
                location,
                start: toIso(start),
                end: toIso(end),
            }),
        })
        onSubmit?.(payload)
    }

    const locationLabel = useMemo(
        () => LOCATIONS.find((l) => l.value === location)?.label ?? 'Select location',
        [location],
    )

    const today = new Date()
    // Strip time for disabling logic (disable before today at 00:00 local)
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())

    return (
        <div
            className={[
                'w-full max-w-5xl mx-auto bg-white rounded-full flex items-center shadow-lg border border-gray-200 divide-x divide-gray-200 relative h-16',
                className,
            ].join(' ')}
            role="search"
            aria-label="Trip search"
        >
            {/* Location */}
            <div ref={locRef} className="relative flex-1 h-full">
                <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={openLocation}
                    onClick={() => setOpenLocation((v) => !v)}
                    className="h-full w-full px-8 py-2 flex flex-col justify-center rounded-l-full hover:bg-gray-100 transition-colors text-left cursor-pointer"
                >
          <span className="text-[12px] font-semibold text-gray-700 tracking-wide">
            Where
          </span>
          <span className="text-[15px] w-50 text-gray-700 truncate pr-4 block items-center gap-2">
           {locationLabel}
          </span>
                </button>

                {openLocation && (
                    <div
                        role="listbox"
                        aria-label="Pickup location"
                        className="absolute top-full left-0 mt-3 w-[420px] bg-white rounded-2xl shadow-2xl border border-gray-100 py-3 z-50"
                    >
                        <Section label="Airports" />
                        {LOCATIONS.filter((l) => l.section === 'Airports').map((opt) => (
                            <LocationOption
                                key={opt.value}
                                option={opt}
                                active={location === opt.value}
                                onSelect={() => {
                                    setLocation(opt.value)
                                    setOpenLocation(false)
                                }}
                            />
                        ))}
                        <Section label="Cities" />
                        {LOCATIONS.filter((l) => l.section === 'Cities').map((opt) => (
                            <LocationOption
                                key={opt.value}
                                option={opt}
                                active={location === opt.value}
                                onSelect={() => {
                                    setLocation(opt.value)
                                    setOpenLocation(false)
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Dates (range) */}
            <div ref={calRef} className="relative flex-[1.4] h-full">
                <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={openCalendar}
                    onClick={() => setOpenCalendar((v) => !v)}
                    className="h-full w-full px-8 py-2 flex flex-col justify-center hover:bg-gray-50 transition-colors text-left cursor-pointer"
                >
          <span className="text-[12px] font-semibold text-gray-700 tracking-wide">
            Dates
          </span>
                    <span className="text-[15px] text-gray-700 truncate pr-4">
            {start && end
                ? `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`
                : 'Add dates'}
          </span>
                </button>

                {openCalendar && (
                    <div className="absolute top-full left-0 mt-3 bg-white p-5 shadow-2xl rounded-2xl border border-gray-100 z-50">
                        <DayPicker
                            mode="range"
                            numberOfMonths={1}
                            selected={{ from: start ?? undefined, to: end ?? undefined }}
                            onSelect={(range) => { setStart(range?.from ?? null); setEnd(range?.to ?? null); }}
                            disabled={{ before: todayStart }}
                            defaultMonth={start ?? todayStart}
                            classNames={calendarClassNames}
                            captionLayout="buttons"
                        />
                        <div className="flex justify-end gap-2 pt-3">
                            <button
                                type="button"
                                className="text-sm px-3 py-1 rounded-lg text-gray-700 hover:text-gray-800 cursor-pointer"
                                onClick={() => {
                                    setStart(null)
                                    setEnd(null)
                                }}
                            >
                                Reset
                            </button>
                            <button
                                type="button"
                                className="text-sm px-3 py-1 rounded-lg bg-emerald-800 text-white hover:bg-emerald-900 cursor-pointer"
                                onClick={() => setOpenCalendar(false)}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Search */}
            <div className="h-full px-2 flex items-center justify-center">
                <button
                    type="button"
                    disabled={!canSearch}
                    onClick={handleSearch}
                    className={[
                        'h-8 w-8 rounded-full flex items-center justify-center text-white transition-transform shadow-md',
                        canSearch ? 'bg-emerald-700 hover:bg-emerald-800 hover:scale-101 cursor-pointer' : 'bg-gray-300 cursor-not-allowed',
                    ].join(' ')}
                    aria-label="Search"
                >
                    <Search size={16} strokeWidth={2.5} />
                </button>
            </div>
        </div>
    )
}

function Section({ label }: { label: string }) {
    return (
        <div className="px-4 pb-2 pt-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {label}
        </div>
    )
}

function LocationOption({
                            option,
                            active,
                            onSelect,
                        }: {
    option: { value: LocationCode; label: string }
    active: boolean
    onSelect: () => void
}) {
    return (
        <button
            type="button"
            role="option"
            aria-selected={active}
            onClick={onSelect}
            className={[
                'w-full text-left px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer',
                active ? 'bg-emerald-600/20 text-gray-800' : 'hover:bg-gray-50 text-gray-500',
            ].join(' ')}
        >
            <div className="p-2 bg-gray-100 rounded-lg">
                <MapPin size={18} className={active ? 'text-emerald-800' : 'text-gray-600'} />
            </div>
            <span className="text-sm font-medium">{option.label}</span>
        </button>
    )
}