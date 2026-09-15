import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search, MapPin } from 'lucide-react'
import { TripCalendar } from '@/components/TripCalendar.tsx'
import { dateKeyToLocalDate, toDateKey } from '@/lib/pricing.ts'

export type LocationCode = 'MSP' | 'stpaul-mpls'

export type SearchBarValue = {
    location: LocationCode
    start?: Date | null
    end?: Date | null
}

// What a caller may hand us as a starting value. Dates arrive from the URL as
// 'YYYY-MM-DD' keys, so strings are accepted alongside real Dates.
export type SearchBarInitial = {
    location?: LocationCode
    start?: Date | string | null
    end?: Date | string | null
}

const LOCATIONS: { value: LocationCode; label: string; section: 'Airports' | 'Cities' }[] = [
    { value: 'MSP', label: 'MSP – Minneapolis–Saint Paul International Airport', section: 'Airports' },
    { value: 'stpaul-mpls', label: 'Minneapolis–St Paul (metro)', section: 'Cities' },
]

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

export function SearchBar({
                              initial,
                              onSubmit,
                              className = '',
                          }: {
    initial?: SearchBarInitial
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

    // Close the location popover on outside click or Escape. The calendar
    // popover handles its own dismissal inside TripCalendar.
    const locRef = useRef<HTMLDivElement>(null)
    const calTriggerRef = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            const t = e.target as Node
            if (openLocation && locRef.current && !locRef.current.contains(t)) setOpenLocation(false)
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpenLocation(false)
        }
        document.addEventListener('mousedown', onDocClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDocClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [openLocation])

    // Stable so TripCalendar's listener effect doesn't resubscribe each render.
    const closeCalendar = useCallback(() => setOpenCalendar(false), [])

    function handleSearch() {
        if (!start || !end) return
        const payload: Required<SearchBarValue> = {
            location,
            start,
            end,
        }
        // Navigate with URL as the source of truth. Bare 'YYYY-MM-DD' keys
        // rather than toISOString(): a full UTC instant shifts the calendar day
        // by one for anyone west of Greenwich, and the car page has to read
        // these back as the days the customer actually clicked.
        navigate({
            to: '/fleet',
            search: () => ({
                location,
                start: toDateKey(start),
                end: toDateKey(end),
            }),
        })
        onSubmit?.(payload)
    }

    const locationLabel = useMemo(
        () => LOCATIONS.find((l) => l.value === location)?.label ?? 'Select location',
        [location],
    )

    return (
        <div
            className={[
                // text-ink is explicit because this also sits on the homepage video,
                // where the surrounding copy is white.
                'w-full max-w-5xl mx-auto bg-surface text-ink rounded-full flex items-center shadow-lg border border-line divide-x divide-line relative h-16',
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
                    className="h-full w-full px-8 py-2 flex flex-col justify-center rounded-l-full hover:bg-subtle transition-colors text-left cursor-pointer"
                >
          <span className="text-[12px] font-semibold tracking-wide">
            Where
          </span>
          <span className="text-[15px] w-50 text-muted truncate pr-4 block items-center gap-2">
           {locationLabel}
          </span>
                </button>

                {openLocation && (
                    <div
                        role="listbox"
                        aria-label="Pickup location"
                        className="absolute top-full left-0 mt-3 w-[420px] bg-surface rounded-2xl shadow-2xl border border-line py-3 z-50"
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
            <div className="relative flex-[1.4] h-full">
                <button
                    ref={calTriggerRef}
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={openCalendar}
                    onClick={() => setOpenCalendar((v) => !v)}
                    className="h-full w-full px-8 py-2 flex flex-col justify-center hover:bg-subtle transition-colors text-left cursor-pointer"
                >
          <span className="text-[12px] font-semibold tracking-wide">
            Dates
          </span>
                    <span className="text-[15px] text-muted truncate pr-4">
            {start && end
                ? `${formatTriggerDate(start)} – ${formatTriggerDate(end)}`
                : 'Add dates'}
          </span>
                </button>

                <TripCalendar
                    mode="range"
                    open={openCalendar}
                    onClose={closeCalendar}
                    triggerRef={calTriggerRef}
                    startDate={start ?? undefined}
                    endDate={end ?? undefined}
                    onSelectRange={(range) => { setStart(range.start ?? null); setEnd(range.end ?? null) }}
                    className="mt-3 z-50"
                    footer={
                        <>
                            <button
                                type="button"
                                className="text-sm px-3 py-1 rounded-lg text-muted hover:text-ink cursor-pointer"
                                onClick={() => {
                                    setStart(null)
                                    setEnd(null)
                                }}
                            >
                                Reset
                            </button>
                            <button
                                type="button"
                                className="text-sm px-3 py-1 rounded-lg bg-brand text-on-brand hover:bg-pine-800 cursor-pointer"
                                onClick={closeCalendar}
                            >
                                Save
                            </button>
                        </>
                    }
                />
            </div>

            {/* Search */}
            <div className="h-full px-2 flex items-center justify-center">
                <button
                    type="button"
                    disabled={!canSearch}
                    onClick={handleSearch}
                    className={[
                        'h-8 w-8 rounded-full flex items-center justify-center text-on-brand transition-transform shadow-md',
                        canSearch ? 'bg-brand hover:bg-pine-800 hover:scale-101 cursor-pointer' : 'bg-cream-300 cursor-not-allowed',
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
        <div className="px-4 pb-2 pt-1 text-xs font-semibold text-muted uppercase tracking-wider">
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
                active ? 'bg-subtle text-ink' : 'hover:bg-subtle text-muted',
            ].join(' ')}
        >
            <div className={['p-2 rounded-lg', active ? 'bg-brand' : 'bg-cream-200'].join(' ')}>
                <MapPin size={18} className={active ? 'text-on-brand' : 'text-muted'} />
            </div>
            <span className="text-sm font-medium">{option.label}</span>
        </button>
    )
}