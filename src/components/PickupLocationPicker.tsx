// Where the customer collects the car, and the only control in the booking
// widget that can change the price.
//
// ── Why this is its own component ────────────────────────────────────────────
// It owns three interacting pieces of state (which group is expanded, what's
// typed in the address box, what the geocoder last returned) and two document
// listeners, none of which the car page has any reason to know about. Same
// division of labour as TripCalendar and PriceBreakdown: the component owns the
// panel, the outside-click and the keyboard handling; the caller owns only the
// value and what a change means. $carId.tsx was already 760 lines before this.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
    BedDouble,
    CarFront,
    ChevronLeft,
    Loader2,
    MapPinned,
    Pencil,
    Plane,
    TramFront,
    X,
} from 'lucide-react'
import { searchAddresses, type AddressSuggestion } from '@/lib/geocode.ts'
import {
    DELIVERY_FEE,
    DELIVERY_RADIUS_MILES,
    HOME_BASE,
    PICKUP_LOCATIONS,
    isWithinDeliveryRadius,
    milesFromHomeBase,
    resolvePickup,
    type PickupLocationKind,
    type PickupSelection,
} from '@/lib/pickup.ts'
import { cn } from '@/lib/utils.ts'

// One request per keystroke would race (a slow response for "203" can land after
// a fast one for "2033 Sarg" and repopulate the list with stale rows) and would
// burn quota on prefixes nobody wants results for. 300ms is long enough to cover
// a normal typing cadence and short enough that a pause feels answered.
const SEARCH_DEBOUNCE_MS = 300

// Icons mirror the ones the admin reservation screen already uses for the same
// concepts, so a location a customer picked looks like the same thing when the
// host opens the reservation.
const KIND_ICONS: Record<PickupLocationKind, typeof Plane> = {
    airport: Plane,
    hotel: BedDouble,
    transit: TramFront,
}

// ── Shared row chrome ────────────────────────────────────────────────────────

// Every option is a button in a radiogroup rather than a div with an onClick.
// A real button is keyboard-reachable and announces its checked state for free;
// role="radio" is what tells assistive tech these are mutually exclusive, which
// is the whole point of the redesign.
function OptionRow({
    icon: Icon,
    title,
    subtitle,
    detail,
    selected,
    onSelect,
    trailing,
}: {
    icon: typeof Plane
    title: string
    subtitle?: string
    detail?: string
    selected: boolean
    onSelect: () => void
    trailing?: React.ReactNode
}) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={onSelect}
            className={cn(
                'w-full flex items-start gap-3 p-3 text-left border border-line rounded-lg transition-colors cursor-pointer',
                // The selected row is filled rather than outlined. An outline
                // would compete with the border every row already has, which is
                // why the Turo reference fills it too.
                selected ? 'bg-subtle border-ink-400' : 'bg-surface hover:bg-subtle',
            )}
        >
            {/* flex-shrink-0 because a long hotel name must wrap in the text
                column rather than squeezing the icon into an oval. */}
            <span className="flex-shrink-0 w-9 h-9 rounded-full border border-ink-400 flex items-center justify-center text-muted">
                <Icon size={16} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{title}</span>
                {subtitle && <span className="block text-xs text-muted mt-0.5">{subtitle}</span>}
                {detail && <span className="block text-xs text-muted mt-0.5">{detail}</span>}
                {trailing}
            </span>
        </button>
    )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-2">
            {children}
        </p>
    )
}

// ── Delivery sub-panel ───────────────────────────────────────────────────────

// Split out because it's the only branch with async state, and keeping it in a
// child means its query/results/pending state unmounts when the customer backs
// out to the list — no manual cleanup, and no stale suggestions waiting behind
// the "Enter delivery address" row if they open it again.
//
// ── The text field is the address; the suggestions only help fill it ─────────
// Picking a suggestion writes it into the input and leaves it editable rather
// than committing and closing. Two reasons, and both matter:
//
// 1. A geocoder returns a *building*. A delivery needs the apartment number, the
//    gate code, "side door by the garage" — the details that only the customer
//    knows and that no autocomplete will ever produce. Making the field
//    authoritative is what gives them somewhere to put those.
// 2. Mapbox's temporary geocoding tier — the default, and what the free 100k
//    requests/month covers — forbids caching or persisting results. Writing
//    Mapbox's formatted address into bookings.pickup_location would require the
//    separately-billed permanent tier. Storing what the customer wrote, and using
//    the lookup purely to answer "is this within ten miles?", stays inside the
//    temporary terms. See resolvePickupOnServer in src/lib/db.ts, which does the
//    same thing on the server and throws its geocode away.
function DeliveryPanel({
    value,
    onChange,
    onDone,
    onBack,
}: {
    value: PickupSelection
    onChange: (next: PickupSelection) => void
    /** Commit and collapse the whole picker. Separate from onChange because,
     *  unlike the free options, this panel changes the value many times before
     *  the customer is finished with it. */
    onDone: () => void
    onBack: () => void
}) {
    const [query, setQuery] = useState(value.kind === 'delivery' ? value.address : '')
    const [results, setResults] = useState<AddressSuggestion[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const [hasSearched, setHasSearched] = useState(false)
    // Set when the customer clicks a row that's out of range. Held separately
    // from the results list so the list stays on screen underneath it — the fix
    // is usually a different row, not a different query.
    const [rejected, setRejected] = useState<AddressSuggestion | null>(null)

    // The last suggestion the customer accepted. Component state, never lifted
    // and never persisted: it exists to show a distance and a fee while they're
    // deciding, and it dies when this panel unmounts. The booking carries only
    // the address text.
    //
    // Seeded from an existing selection so reopening the panel doesn't present a
    // filled-in address that the UI treats as unconfirmed. The coordinates on the
    // selection were verified when it was made; rebuilding the distance from them
    // is cheaper and steadier than re-querying on every open.
    const [verified, setVerified] = useState<AddressSuggestion | null>(() => {
        // Only a selection that still carries coordinates counts as verified —
        // reopening the panel on a half-typed address must not resurrect it as
        // confirmed.
        if (value.kind !== 'delivery' || value.lat === undefined || value.lng === undefined) {
            return null
        }
        const point = { lat: value.lat, lng: value.lng }
        return {
            id: value.address,
            label: value.address,
            ...point,
            distanceMiles: milesFromHomeBase(point),
            withinRadius: isWithinDeliveryRadius(point),
        }
    })

    // Guards against out-of-order responses. Each debounced run claims a number;
    // when its response arrives it only writes to state if no newer run has
    // started since. Without this, a slow lookup for an early prefix can resolve
    // after a fast one for the full address and overwrite good results with bad.
    const requestId = useRef(0)

    // Set when the input is filled programmatically by picking a suggestion.
    // Without it, writing the chosen address into the field would immediately
    // re-run the search and pop the dropdown back open over the customer's answer.
    const skipNextSearch = useRef(false)

    useEffect(() => {
        if (skipNextSearch.current) {
            skipNextSearch.current = false
            return
        }

        const trimmed = query.trim()
        if (trimmed.length < 3) {
            setResults([])
            setHasSearched(false)
            return
        }

        const id = ++requestId.current
        setIsSearching(true)

        const timer = setTimeout(() => {
            void searchAddresses({ data: trimmed })
                .then(found => {
                    if (requestId.current !== id) return
                    setResults(found)
                    setHasSearched(true)
                })
                .finally(() => {
                    if (requestId.current === id) setIsSearching(false)
                })
        }, SEARCH_DEBOUNCE_MS)

        // Clearing the timer on every keystroke is what makes this a debounce
        // rather than a throttle: only the last keystroke in a burst ever fires.
        return () => clearTimeout(timer)
    }, [query])

    const handlePick = (suggestion: AddressSuggestion) => {
        // An out-of-range address is rejected here, at the click, rather than
        // being committed and left for the Continue button to refuse. The
        // customer finds out at the moment they made the choice, next to the row
        // they chose — not from a message at the bottom of a card whose
        // connection to this list they have to work out for themselves.
        if (!suggestion.withinRadius) {
            setRejected(suggestion)
            return
        }
        setRejected(null)
        setVerified(suggestion)
        skipNextSearch.current = true
        setQuery(suggestion.label)
        setResults([])
        onChange({
            kind: 'delivery',
            address: suggestion.label,
            lat: suggestion.lat,
            lng: suggestion.lng,
        })
    }

    const handleType = (next: string) => {
        setQuery(next)
        setRejected(null)

        // Refining a verified address — adding "Apt 4B" — keeps the coordinates,
        // so the fee and distance stay on screen instead of flickering off while
        // the customer finishes typing. The test is whether the confirmed address
        // is still recognisably in there; edit it away and the verification is
        // dropped and the search starts again, because at that point it's a
        // different address wearing the old one's coordinates.
        //
        // Either way the server geocodes the final text and re-checks the radius,
        // so this heuristic only governs what's displayed here — it can be
        // generous without being able to let a bad address through.
        if (verified && next.includes(verified.label)) {
            onChange({ kind: 'delivery', address: next, lat: verified.lat, lng: verified.lng })
            return
        }

        // Verification lost. The new text is lifted *without* coordinates rather
        // than leaving the old selection in place: the parent would otherwise go
        // on quoting $140 for the address the customer has just typed over, with
        // the card showing one address and the field showing another. Coordinate-
        // less delivery resolves to an error, so the price drops away and Continue
        // blocks until an address is picked again.
        if (verified) setVerified(null)
        onChange({ kind: 'delivery', address: next })
    }

    const canConfirm = verified !== null && query.trim().length > 0

    return (
        <div className="space-y-3">
            <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink transition-colors cursor-pointer"
            >
                <ChevronLeft size={14} /> All pickup options
            </button>

            <div>
                <input
                    type="text"
                    // autoFocus is safe here specifically because this panel only
                    // mounts in response to a click on "Enter delivery address" —
                    // it never steals focus on page load.
                    autoFocus
                    value={query}
                    onChange={e => handleType(e.target.value)}
                    placeholder="Start typing an address"
                    className="w-full border border-line rounded-md px-3 py-2 text-sm text-ink outline-none focus:border-muted transition-colors"
                />
                {/*<p className="text-xs text-muted mt-1.5">*/}
                {/*    {verified*/}
                {/*        ? 'Add an apartment or unit number if you have one — this is the address we’ll deliver to.'*/}
                {/*        : `$${DELIVERY_FEE} delivery fee · within ${DELIVERY_RADIUS_MILES} miles of ${HOME_BASE.label}`}*/}
                {/*</p>*/}
            </div>

            {isSearching && (
                <p className="flex items-center gap-2 text-xs text-muted">
                    <Loader2 size={13} className="animate-spin" /> Searching addresses…
                </p>
            )}

            {results.length > 0 && (
                <div className="space-y-2">
                    {results.map(suggestion => (
                        <button
                            // Keyed by Mapbox's own id, not the array index. Index
                            // keys let React reuse a row across two different
                            // result sets, so a click could commit the previous
                            // set's coordinates under the current set's label.
                            key={suggestion.id}
                            type="button"
                            role="radio"
                            aria-checked={verified?.label === suggestion.label}
                            onClick={() => handlePick(suggestion)}
                            className={cn(
                                'w-full flex items-start gap-3 p-3 text-left border rounded-lg transition-colors cursor-pointer',
                                verified?.label === suggestion.label
                                    ? 'bg-subtle border-ink-400'
                                    : 'bg-surface border-line hover:bg-subtle',
                                // Out-of-range rows stay visible and clickable
                                // rather than being filtered out. Seeing "43.1
                                // miles" next to the address the customer typed
                                // explains the rejection; an empty list would
                                // just look like the address doesn't exist.
                                !suggestion.withinRadius && 'opacity-60',
                            )}
                        >
                            <span className="flex-shrink-0 w-9 h-9 rounded-full border border-ink-400 flex items-center justify-center text-muted">
                                <MapPinned size={16} />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm text-ink">{suggestion.label}</span>
                                <span
                                    className={cn(
                                        'block text-xs mt-0.5',
                                        suggestion.withinRadius ? 'text-muted' : 'text-red-600',
                                    )}
                                >
                                    {suggestion.distanceMiles} miles away
                                    {suggestion.withinRadius
                                        ? ` · $${DELIVERY_FEE} delivery fee`
                                        : ' · outside the delivery area'}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {rejected && (
                <p className="text-xs text-red-600">
                    {rejected.label} is {rejected.distanceMiles} miles away. Delivery is only
                    available within {DELIVERY_RADIUS_MILES} miles of {HOME_BASE.label} — please
                    choose a closer address or pick one of the free pickup locations.
                </p>
            )}

            {/* hasSearched gates this so it doesn't flash between the debounce
                firing and the response landing, when results is legitimately
                still empty. */}

            {/*{hasSearched && !isSearching && results.length === 0 && (*/}
            {/*    <p className="text-xs text-muted">*/}
            {/*        We couldn't find that address. Try including the city and ZIP code.*/}
            {/*    </p>*/}
            {/*)}*/}

            {/* Only reachable once a suggestion has been accepted, which is what
                makes it the confirmation step: the customer has seen the distance,
                seen the fee, and had the chance to append a unit number. Free
                locations need no equivalent because there is nothing left to say
                about them after the click. */}
            {canConfirm && verified && (
                <div className="pt-1 space-y-2">
                    <p className="text-xs text-muted">
                        {verified.distanceMiles} miles away · ${DELIVERY_FEE} delivery fee
                    </p>
                    <button
                        type="button"
                        onClick={onDone}
                        className="w-full py-2 rounded-lg bg-brand text-on-brand text-sm font-medium hover:bg-pine-800 transition-colors cursor-pointer"
                    >
                        Use this address
                    </button>
                </div>
            )}
        </div>
    )
}

// ── Picker ───────────────────────────────────────────────────────────────────

export function PickupLocationPicker({
    value,
    onChange,
    className,
}: {
    value: PickupSelection
    onChange: (next: PickupSelection) => void
    className?: string
}) {
    const [isOpen, setIsOpen] = useState(false)
    const [isDeliveryOpen, setIsDeliveryOpen] = useState(false)
    const [showAirportInfo, setShowAirportInfo] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    const resolved = resolvePickup(value)

    const close = useCallback(() => {
        setIsOpen(false)
        setIsDeliveryOpen(false)
        setShowAirportInfo(false)
    }, [])

    useEffect(() => {
        if (!isOpen && !showAirportInfo) return

        // Deliberately `mousedown`, matching TripCalendar for the same reason:
        // this picker lives in the same card as the two date popovers, and those
        // open on mousedown. A `click` listener attached during the mousedown
        // that opened this panel would see the tail of that very interaction and
        // dismiss the panel before it ever rendered.
        function onDocumentMouseDown(e: MouseEvent) {
            if (containerRef.current?.contains(e.target as Node)) return
            close()
        }
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') close()
        }

        document.addEventListener('mousedown', onDocumentMouseDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('mousedown', onDocumentMouseDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [isOpen, showAirportInfo, close])

    // Choosing a free option collapses the whole panel: the decision is complete
    // the moment it's clicked, and leaving it open would make the customer hunt
    // for a way to dismiss something they've already finished with. Delivery is
    // the exception — it needs an address next — so it opens a sub-panel instead.
    const selectAndClose = (next: PickupSelection) => {
        onChange(next)
        close()
    }

    return (
        <div ref={containerRef} className={cn('relative', className)}>
            <div className="p-3">
                <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <label className="text-[14px] font-semibold text-ink">
                            Pickup &amp; return location
                        </label>

                        {/* The resolved label, or a prompt when the selection is
                            in a state that can't be summarised — an unknown id,
                            or delivery with nothing chosen yet. resolved.error
                            carries the detail; the car page renders that message
                            next to the Continue button, so it isn't repeated. */}
                        <p className="text-sm text-ink mt-0.5 break-words">
                            {resolved.label || 'Choose a pickup location'}
                        </p>

                        {/*{value.kind === 'home' && (*/}
                        {/*    <p className="text-xs text-muted mt-1">*/}
                        {/*        The exact address will be sent once your trip is booked.*/}
                        {/*    </p>*/}
                        {/*)}*/}

                        {resolved.fee > 0 && (
                            <p className="text-xs text-muted mt-1 font-medium">
                                ${resolved.fee} delivery fee
                            </p>
                        )}

                        {/*<button*/}
                        {/*    type="button"*/}
                        {/*    onClick={() => setShowAirportInfo(o => !o)}*/}
                        {/*    className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors cursor-pointer"*/}
                        {/*>*/}

                    {/* Re-add `Info` to the lucide-react import above if this
                            is switched back on. */}
                        {/*    About airport pickups <Info size={12} />*/}
                        {/*</button>*/}
                    </div>

                    {/* The pencil, matching the reference. It's a toggle rather
                        than an open-only affordance so the same target both
                        reveals and dismisses the panel — with the panel open,
                        it's the control the eye is already on. */}
                    <button
                        type="button"
                        onClick={() => {
                            setIsOpen(o => !o)
                            setIsDeliveryOpen(false)
                        }}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? 'Close pickup locations' : 'Edit pickup location'}
                        className={cn(
                            'flex-shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center transition-colors cursor-pointer',
                            isOpen
                                ? 'border-brand ring-2 ring-brand/30 text-brand'
                                : 'border-ink-400 text-muted hover:bg-subtle',
                        )}
                    >
                        <Pencil size={14} />
                    </button>
                </div>

                {showAirportInfo && (
                    <div className="mt-3 rounded-lg bg-subtle border border-line p-3 relative">
                        <button
                            type="button"
                            onClick={() => setShowAirportInfo(false)}
                            aria-label="Close"
                            className="absolute top-2 right-2 text-ink-400 hover:text-ink cursor-pointer"
                        >
                            <X size={14} />
                        </button>
                        {/* PLACEHOLDER COPY — replace with the real airport
                            policy. Kept in the component (rather than pulled from
                            the database) because it's the same for every car and
                            changes about as often as the terms of service. */}
                        <p className="text-xs text-muted pr-5 leading-relaxed">
                            Airport pickups are free. We'll meet you at the arrivals curb and
                            text you the exact door number the day before your trip. If your
                            flight is delayed, message us and we'll adjust the meeting time at
                            no charge.
                        </p>
                    </div>
                )}

                {isOpen && (
                    <div
                        role="radiogroup"
                        aria-label="Pickup and return location"
                        className="mt-3 pt-3 border-t border-line space-y-4"
                    >
                        {isDeliveryOpen ? (
                            <DeliveryPanel
                                value={value}
                                // Deliberately NOT closing on change, unlike the
                                // free options above. A delivery address is edited
                                // in several steps — type, pick, refine — and each
                                // one lifts the current value so the price above
                                // stays live; collapsing on the first of them
                                // would take the field away mid-sentence.
                                onChange={onChange}
                                onDone={close}
                                onBack={() => setIsDeliveryOpen(false)}
                            />
                        ) : (
                            <>
                                <div>
                                    <GroupLabel>Pickup at car location</GroupLabel>
                                    <OptionRow
                                        icon={CarFront}
                                        title={HOME_BASE.label}
                                        selected={value.kind === 'home'}
                                        onSelect={() => selectAndClose({ kind: 'home' })}
                                    />
                                    {/* Sits outside the row so it reads as a
                                        policy note about the option rather than
                                        part of the address itself. */}
                                    <p className="text-xs text-muted mt-2">
                                        The exact address will be sent once your trip is booked.
                                    </p>
                                </div>

                                <div>
                                    <GroupLabel>Pickup locations</GroupLabel>
                                    <div className="space-y-2">
                                        {PICKUP_LOCATIONS.map(location => (
                                            <OptionRow
                                                key={location.id}
                                                icon={KIND_ICONS[location.kind]}
                                                title={location.name}
                                                subtitle={location.subtitle}
                                                detail={location.address}
                                                selected={
                                                    value.kind === 'listed' && value.id === location.id
                                                }
                                                onSelect={() =>
                                                    selectAndClose({ kind: 'listed', id: location.id })
                                                }
                                            />
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <GroupLabel>Bring the car to me</GroupLabel>
                                    <OptionRow
                                        icon={MapPinned}
                                        title={
                                            value.kind === 'delivery' && value.address
                                                ? value.address
                                                : 'Enter delivery address'
                                        }
                                        subtitle={`$${DELIVERY_FEE} · within ${DELIVERY_RADIUS_MILES} miles`}
                                        selected={value.kind === 'delivery'}
                                        // The only row that opens something instead
                                        // of committing: an address has to be
                                        // resolved before this selection means
                                        // anything, so it can't be chosen in one
                                        // click the way the free options can.
                                        onSelect={() => setIsDeliveryOpen(true)}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}