// The one date picker on the customer-facing site.
//
// Two screens use it and they need to feel like the same control: the search
// bar picks a whole range in one popover (mode="range"), while the car page's
// booking widget edits the two ends separately (mode="start" / mode="end") so
// each can sit next to its own time dropdown. Both render identically because
// the highlight is driven by the `startDate`/`endDate` *props* rather than by
// DayPicker's own `selected` — which is also what lets the Trip end calendar
// show the already-chosen start date, something two independent single-mode
// pickers could never do.
//
// The component owns the popover panel, the outside-click listener and Escape
// handling. Callers own only the open flag and what a selection means.

import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from 'react'
import { DayPicker, type ClassNames, type Matcher } from 'react-day-picker'
import 'react-day-picker/style.css'
import type { DateSpan } from '@/lib/availability.ts'
import { daysBetween, toDateKey } from '@/lib/pricing.ts'
import { cn } from '@/lib/utils.ts'

type TripCalendarBase = {
    open: boolean
    /**
     * Outside-click or Escape. Selecting a day does NOT call this — the caller
     * decides what happens next, which is how the car page can close the start
     * calendar and open the end one in the same gesture.
     */
    onClose: () => void
    /** Excluded from outside-click, so the trigger's own onClick can toggle. */
    triggerRef?: RefObject<HTMLElement | null>
    startDate?: Date
    endDate?: Date
    /** Days this car is already taken. Rendered struck-through and inert. */
    unavailableRanges?: DateSpan[]
    /** Earliest selectable day. Defaults to today at local midnight. */
    minDate?: Date
    defaultMonth?: Date
    numberOfMonths?: number
    footer?: ReactNode
    /** Position / z-index overrides for the popover panel. */
    className?: string
}

// A discriminated union rather than three optional callbacks, so the compiler
// catches a mode/handler mismatch instead of the handler silently never firing.
export type TripCalendarProps = TripCalendarBase &
    (
        | { mode: 'range'; onSelectRange: (range: { start?: Date; end?: Date }) => void }
        | { mode: 'start'; onSelectStart: (date: Date) => void }
        | { mode: 'end'; onSelectEnd: (date: Date) => void }
    )

// Stable identity so the memos below don't invalidate on every render when a
// caller omits the prop.
const NO_SPANS: DateSpan[] = []

function todayLocalMidnight(): Date {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export const tripCalendarClassNames: Partial<ClassNames> = {
    root: 'p-0 font-sans',
    months: 'flex flex-col',
    month: 'space-y-3',
    month_caption: 'flex justify-center items-center h-9 relative',
    caption_label: 'text-sm font-semibold text-ink tracking-wide',
    nav: 'w-full flex items-center justify-center relative h-5',
    button_previous:
        'absolute left-2 top-0 w-7 h-7 rounded-md border border-line inline-flex items-center justify-center bg-transparent hover:bg-subtle transition-colors cursor-pointer',
    button_next:
        'absolute right-2 top-0 w-7 h-7 rounded-md border border-line inline-flex items-center justify-center bg-transparent hover:bg-subtle transition-colors cursor-pointer',
    month_grid: 'w-full border-collapse',
    weekdays: 'flex',
    weekday: 'w-9 text-center text-[10px] font-medium text-muted uppercase tracking-widest pb-1',
    week: 'flex mt-1',
    day: 'w-9 h-9 text-center text-sm p-0',

    // Hover changes the background only — never the radius, which belongs to
    // the modifier slots below so the range pill can't reshape under the mouse.
    // The base radius is round so an unselected day still hovers as a circle.
    //
    // Every affordance is gated behind :not(:disabled) rather than being undone
    // afterwards. This slot lands on the <button> while `disabled` below lands
    // on the parent <td>, so tailwind-merge never sees the pair and raw CSS
    // specificity decides — and `hover:text-white` (0,2,0) would beat
    // `[&>button]:text-gray-300` (0,1,1), which is exactly why booked days used
    // to flash white on hover. Not emitting the rule at all has no such tie.
    day_button: [
        'w-9 h-9 rounded-full text-sm font-medium text-ink',
        'transition-colors focus:outline-none',
        'not-disabled:cursor-pointer',
        'not-disabled:hover:bg-cream-200',
    ].join(' '),

    today: '[&>button]:underline',

    // Deliberately colour-free and radius-free. In range mode DayPicker sets
    // `selected` on the interior days too, so anything visual here would tie
    // with range_middle at equal specificity and let stylesheet order decide
    // the winner — which is why the middle tint never rendered before.
    selected: '[&>button]:font-semibold',

    // The hover backgrounds are !important on purpose: the base hover above
    // compiles to `.cls:not(:disabled):hover` (0,3,0) while these compile to
    // `.cls > button:hover` (0,2,1), so without it a selected day would turn
    // grey under the mouse and break the pill.
    range_start:
        '[&>button]:rounded-l-full [&>button]:rounded-r-none [&>button]:bg-brand [&>button]:text-on-brand [&>button]:hover:bg-brand!',
    range_middle:
        '[&>button]:rounded-none [&>button]:bg-brand [&>button]:text-on-brand [&>button]:hover:bg-brand!',
    range_end:
        '[&>button]:rounded-r-full [&>button]:rounded-l-none [&>button]:bg-brand [&>button]:text-on-brand [&>button]:hover:bg-brand!',

    // No colour here either — colour belongs to the range_* slots, so a booked
    // day sitting inside a selected range doesn't pit text-white against
    // text-gray-300. Opacity and line-through compose over any background.
    //
    // pointer-events-none is the belt to not-disabled:'s braces: a *focused*
    // disabled day gets aria-disabled but not the disabled attribute, so
    // :not(:disabled) would let hover styles back in for that one cell. It also
    // settles the cursor — with pointer events off the pointer resolves against
    // the <td>, which sets no cursor, so there's no "no entry" symbol.
    disabled: 'cursor-default [&>button]:pointer-events-none [&>button]:opacity-40',
    outside: '[&>button]:text-ink-400 [&>button]:opacity-50',
    hidden: 'invisible',
}

// useLayoutEffect warns during SSR ("does nothing on the server"); this
// component's panel is only ever measured client-side (it's null until
// `open`, which starts false), so fall back to useEffect on the server to
// keep that warning out of dev builds.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export const tripCalendarModifierClassNames = {
    booked: '[&>button]:line-through',
    // One selected day rather than a span: either no end chosen yet, or a
    // start and end on the same date. !important so it wins outright over
    // range_start/range_end, which both land on a same-day selection and would
    // otherwise fight over the left and right corners with nothing but
    // stylesheet order to separate them.
    pill: '[&>button]:rounded-full! [&>button]:bg-brand! [&>button]:text-on-brand [&>button]:hover:bg-pine-950!',
}

export function TripCalendar(props: TripCalendarProps) {
    const {
        open,
        onClose,
        triggerRef,
        startDate,
        endDate,
        unavailableRanges = NO_SPANS,
        minDate,
        defaultMonth,
        numberOfMonths = 1,
        footer,
        className,
    } = props
    const mode = props.mode

    const panelRef = useRef<HTMLDivElement>(null)

    // Where the panel renders and how tall it's allowed to get. Recomputed
    // every time it opens: the home page's hero centers its content
    // vertically, which can leave less room below the trigger than the
    // calendar naturally needs, and without this the panel used to run past
    // the viewport and get clipped by an ancestor, hiding the Reset/Save
    // footer entirely. Measuring after mount (rather than guessing from CSS
    // alone) is what lets this same component serve triggers anywhere on the
    // page without knowing its surroundings in advance.
    const [placement, setPlacement] = useState<{ anchor: 'below' | 'above'; maxHeight?: number }>(
        { anchor: 'below' },
    )

    // Resolved once per mount so a calendar left open across midnight doesn't
    // shift under the customer mid-session.
    const today = useMemo(todayLocalMidnight, [])

    // The end calendar can't go earlier than the start date. Deriving it here
    // rather than at the call site means the two pickers can't disagree.
    const min = useMemo(() => {
        const floor = minDate ?? today
        return mode === 'end' && startDate && startDate > floor ? startDate : floor
    }, [mode, minDate, today, startDate])

    // The trip's OTHER end, when it's already been chosen.
    const oppositeEndpointKey = useMemo(() => {
        if (mode === 'start') return endDate ? toDateKey(endDate) : null
        if (mode === 'end') return startDate ? toDateKey(startDate) : null
        return null
    }, [mode, startDate, endDate])

    // A predicate rather than surgery on the spans: the excluded day can sit
    // anywhere inside a span, and splitting one range into two around it would
    // be more code for the same answer.
    const unavailableMatchers = useMemo<Matcher[]>(() => {
        if (!unavailableRanges.length) return []
        if (oppositeEndpointKey === null) return [...unavailableRanges]

        return [
            (day: Date) => {
                const key = toDateKey(day)
                if (key === oppositeEndpointKey) return false
                return unavailableRanges.some(
                    span => toDateKey(span.from) <= key && key <= toDateKey(span.to),
                )
            },
        ]
    }, [unavailableRanges, oppositeEndpointKey])

    const disabledMatchers = useMemo<Matcher[]>(
        () => [{ before: min }, ...unavailableMatchers],
        [min, unavailableMatchers],
    )

    const resolvedDefaultMonth = useMemo(() => {
        if (defaultMonth) return defaultMonth
        if (mode === 'end') return endDate ?? startDate ?? min
        return startDate ?? min
    }, [defaultMonth, mode, startDate, endDate, min])

    const modifiers = useMemo<Record<string, Matcher | Matcher[] | undefined>>(() => {
        const next: Record<string, Matcher | Matcher[]> = {}
        // Same matchers the disabled set uses, so the strikethrough can never
        // mark a day this picker is willing to accept.
        if (unavailableMatchers.length) next.booked = unavailableMatchers

        // How many calendar days the selection spans, or null if it isn't a
        // pair yet. 0 means start and end landed on the same day.
        const span =
            startDate && endDate
                ? daysBetween(toDateKey(startDate), toDateKey(endDate))
                : null

        if (mode === 'range') {
            // DayPicker owns range_start/range_middle/range_end whenever the
            // selection is a range — setting them here would be overwritten.
            // Ours are the cases it renders badly: no end yet, and a same-day
            // selection, where it marks the cell as both start and end.
            if (startDate && (span === null || span === 0)) next.pill = startDate
            return next
        }

        // Single mode: the highlight comes from the props, so the Trip end
        // calendar shows the chosen start date even though it isn't `selected`.
        // These custom names deliberately collide with DayPicker's reserved
        // ones, which makes them fall through to classNames.range_* and reuse
        // the exact strings range mode uses.
        if (startDate && endDate && span !== null && span > 0) {
            next.range_start = startDate
            next.range_end = endDate
            // Guard: a {after, before} interval whose bounds are equal is
            // treated as an OPEN interval and matches every day *except* that
            // one. Only emit a middle when there's at least one day between.
            if (span > 1) {
                next.range_middle = { after: startDate, before: endDate }
            }
        } else if (startDate) {
            next.pill = startDate
        } else if (endDate) {
            next.pill = endDate
        }

        return next
    }, [mode, startDate, endDate, unavailableMatchers])

    // Runs before paint (useLayoutEffect), so a flip never flickers: the panel
    // always mounts anchored below first (both to measure its natural height
    // and because that's the common case), and this only touches state when
    // the trigger doesn't have room for it there.
    useIsomorphicLayoutEffect(() => {
        if (!open) {
            setPlacement({ anchor: 'below' })
            return
        }
        const trigger = triggerRef?.current
        const panelEl = panelRef.current
        if (!trigger || !panelEl) return

        const GAP = 8 // matches the mt-2 / mb-2 offset from the trigger
        const EDGE_MARGIN = 16 // "slightly before the end of the page", not flush with it

        const triggerRect = trigger.getBoundingClientRect()
        const naturalHeight = panelEl.getBoundingClientRect().height
        const spaceBelow = window.innerHeight - triggerRect.bottom - GAP - EDGE_MARGIN
        const spaceAbove = triggerRect.top - GAP - EDGE_MARGIN

        // Flip only when the other side fully fits — otherwise flipping just
        // trades "overflows the bottom" for "overlaps whatever's above the
        // trigger" without actually fixing anything. Most triggers have
        // plenty of room below and never reach this branch at all.
        const fitsBelow = naturalHeight <= spaceBelow
        const fitsAbove = naturalHeight <= spaceAbove
        const anchor = !fitsBelow && fitsAbove ? 'above' : 'below'
        const available = anchor === 'above' ? spaceAbove : spaceBelow

        // Neither side may have enough room (a short viewport, or a trigger
        // near the middle of a vertically-centered layout like the home
        // page's hero). Clamping height and scrolling internally beats
        // silently overflowing into whatever ancestor happens to clip it —
        // that's what made Reset/Save unreachable before this existed.
        setPlacement({
            anchor,
            maxHeight: naturalHeight > available ? Math.max(available, 200) : undefined,
        })
    }, [open, mode, triggerRef])

    useEffect(() => {
        if (!open) return

        // Deliberately `mousedown`, not `click` or `pointerdown`. The car page
        // opens the end calendar from the start calendar's onClick; by the time
        // this listener is attached the mousedown that triggered it is already
        // over, so the new panel doesn't immediately dismiss itself. Switching
        // this to a later event in the sequence would break that.
        function onDocumentMouseDown(e: MouseEvent) {
            const target = e.target as Node
            if (panelRef.current?.contains(target)) return
            if (triggerRef?.current?.contains(target)) return
            onClose()
        }
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }

        document.addEventListener('mousedown', onDocumentMouseDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('mousedown', onDocumentMouseDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [open, onClose, triggerRef])

    if (!open) return null

    // Only PropsBase keys, so this spreads cleanly into either branch of
    // DayPicker's mode-discriminated props union.
    const shared = {
        numberOfMonths,
        disabled: disabledMatchers,
        defaultMonth: resolvedDefaultMonth,
        modifiers,
        modifiersClassNames: tripCalendarModifierClassNames,
        classNames: tripCalendarClassNames,
    }

    // The footer (Reset/Save) is a flex sibling outside the scrollable area,
    // not stacked inside it — so on the rare trigger where neither side of the
    // page has room for the whole calendar, the days scroll internally but the
    // action buttons never do. That's what actually keeps them reachable;
    // clamping the whole panel's height alone just moved the same problem
    // from the viewport edge to the scroll boundary.
    const panel = (children: ReactNode) => (
        <div
            ref={panelRef}
            role="dialog"
            aria-label="Choose dates"
            style={placement.maxHeight ? { maxHeight: placement.maxHeight } : undefined}
            className={cn(
                'absolute left-0 z-[110] flex flex-col bg-surface text-ink p-5 shadow-2xl rounded-2xl border border-line',
                placement.anchor === 'below' ? 'top-full mt-2' : 'bottom-full mb-2',
                className,
            )}
        >
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            {footer && <div className="flex justify-end gap-2 pt-3 flex-shrink-0">{footer}</div>}
        </div>
    )

    if (props.mode === 'range') {
        return panel(
            <DayPicker
                mode="range"
                selected={{ from: startDate, to: endDate }}
                onSelect={range => props.onSelectRange({ start: range?.from, end: range?.to })}
                {...shared}
            />,
        )
    }

    // `required` matters: without it, clicking the day that's already selected
    // fires onSelect(undefined) and the caller never hears the click, leaving
    // the popover stuck open. With it, onSelect always receives a real Date.
    return panel(
        <DayPicker
            mode="single"
            required
            selected={props.mode === 'start' ? startDate : endDate}
            onSelect={date =>
                props.mode === 'start' ? props.onSelectStart(date) : props.onSelectEnd(date)
            }
            {...shared}
        />,
    )
}
