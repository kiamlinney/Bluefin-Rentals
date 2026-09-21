import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { TripCalendar } from '@/components/TripCalendar.tsx'
import { dateKeyToLocalDate, toDateKey } from '@/lib/pricing.ts'


export type SearchBarValue = {
    start?: Date | null
    end?: Date | null
}

// What a caller may hand us as a starting value. Dates arrive from the URL as
// 'YYYY-MM-DD' keys, so strings are accepted alongside real Dates.
export type SearchBarInitial = {
    start?: Date | string | null
    end?: Date | string | null
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

    const [start, setStart] = useState<Date | null>(coerceDate(initial?.start))
    const [end, setEnd] = useState<Date | null>(coerceDate(initial?.end))
    const [openCalendar, setOpenCalendar] = useState(false)

    const canSearch = useMemo(() => !!start && !!end, [start, end])

    // The calendar handles its own outside-click and Escape dismissal.
    const calTriggerRef = useRef<HTMLButtonElement>(null)

    // Stable so TripCalendar's listener effect doesn't resubscribe each render.
    const closeCalendar = useCallback(() => setOpenCalendar(false), [])

    function handleSearch() {
        if (!start || !end) return
        const payload: Required<SearchBarValue> = { start, end }
        // Navigate with URL as the source of truth. Bare 'YYYY-MM-DD' keys
        // rather than toISOString(): a full UTC instant shifts the calendar day
        // by one for anyone west of Greenwich, and the car page has to read
        // these back as the days the customer actually clicked.
        navigate({
            to: '/fleet',
            search: () => ({
                start: toDateKey(start),
                end: toDateKey(end),
            }),
        })
        onSubmit?.(payload)
    }

    return (
        <div
            className={[
                // text-ink is explicit because this also sits on the homepage video,
                // where the surrounding copy is white.
                // text-left for the same reason: on phones the homepage hero
                // centres its text, and text alignment is inherited.
                'w-full max-w-5xl mx-auto bg-surface text-ink text-left shadow-lg border border-line relative',
                // Phones: a stacked card, one field per row
                'flex flex-col divide-y divide-line rounded-3xl',
                'sm:flex-row sm:items-center sm:divide-y-0 sm:divide-x sm:rounded-full sm:h-16',
                className,
            ].join(' ')}
            role="search"
            aria-label="Trip search"
        >
            {/* Dates (range) */}
            <div className="relative sm:flex-1 sm:h-full">
                <button
                    ref={calTriggerRef}
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={openCalendar}
                    onClick={() => setOpenCalendar((v) => !v)}
                    className="h-14 sm:h-full w-full px-6 sm:px-8 py-2 flex flex-col justify-center rounded-t-3xl sm:rounded-tr-none sm:rounded-l-full hover:bg-subtle transition-colors text-left cursor-pointer"
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
            {/* Phones get a full-width labelled button, since a 32px icon is a
                small tap target and doesn't say what it does. From sm up it's
                the original round icon, and the label becomes screen-reader-only
                (sm:sr-only), so the button keeps its accessible name either way. */}
            <div className="p-2 sm:p-0 sm:h-full sm:px-2 flex items-center justify-center">
                <button
                    type="button"
                    disabled={!canSearch}
                    onClick={handleSearch}
                    className={[
                        'h-12 w-full gap-2 font-semibold sm:h-8 sm:w-8 rounded-full flex items-center justify-center transition-transform shadow-md',
                        // Near-white text on the
                        // light disabled fill was barely readable.
                        canSearch
                            ? 'bg-brand text-on-brand hover:bg-pine-800 hover:scale-101 cursor-pointer'
                            : 'bg-cream-300 text-muted cursor-not-allowed',
                    ].join(' ')}
                >
                    <Search size={16} strokeWidth={2.5} />
                    <span className="sm:sr-only">Search</span>
                </button>
            </div>
        </div>
    )
}