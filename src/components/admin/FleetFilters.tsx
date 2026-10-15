import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { FilterPopover, PopoverFooter, PopoverOption, PopoverOptions } from '@/components/admin/FilterPopover'
import { carMainImageUrl } from '@/lib/car-images'
import {
    CAR_SORTS,
    DEFAULT_CAR_SORT,
    LISTING_STATUSES,
    compareCarNames,
    type CarSort,
    type FleetCar,
    type ListingStatus,
} from '@/lib/fleet-view'

// The fleet filters shared by the calendar and the Vehicles page. Each one is
// controlled: the page owns the applied value (in its URL) and gets told when
// the panel applies a new one.

const SEARCH_DEBOUNCE_MS = 200

/**
 * The text box keeps what's typed in its own state and hands it to the page
 * once typing pauses. Bound straight to the URL, every keystroke was a router
 * navigation and a re-render of the whole calendar before the character
 * showed, so fast typing lagged and dropped letters.
 */
export function FleetSearchField({
    value,
    onChange,
    className,
}: {
    value: string
    onChange: (value: string) => void
    className?: string
}) {
    const [text, setText] = useState(value)
    const sent = useRef(value)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

    // A change from outside (Clear filters, the back button) replaces what's typed.
    useEffect(() => {
        if (value !== sent.current) {
            sent.current = value
            setText(value)
        }
    }, [value])

    useEffect(() => {
        if (text === sent.current) return
        const timer = setTimeout(() => {
            sent.current = text
            onChangeRef.current(text)
        }, SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [text])

    const clear = () => {
        setText('')
        sent.current = ''
        onChange('')
    }

    return (
        <div className={`flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 ${className ?? ''}`}>
            <input
                type="search"
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Make, model, plate #"
                aria-label="Search vehicles"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400 [&::-webkit-search-cancel-button]:hidden"
            />
            {text ? (
                <button type="button" onClick={clear} aria-label="Clear search" className="text-gray-400 hover:text-gray-700 cursor-pointer">
                    <X size={16} />
                </button>
            ) : (
                <Search size={16} className="text-gray-400" />
            )}
        </div>
    )
}

export function SortFilter({ value, onChange }: { value: CarSort; onChange: (sort: CarSort) => void }) {
    return (
        <FilterPopover label="Sort">
            {close => <SortPanel value={value} onApply={sort => { onChange(sort); close() }} />}
        </FilterPopover>
    )
}

function SortPanel({ value, onApply }: { value: CarSort; onApply: (sort: CarSort) => void }) {
    const [draft, setDraft] = useState(value)
    return (
        <>
            <PopoverOptions>
                {(Object.entries(CAR_SORTS) as [CarSort, { label: string; hint?: string }][]).map(([key, sort]) => (
                    <PopoverOption key={key} type="radio" checked={draft === key} onChange={() => setDraft(key)} hint={sort.hint}>
                        {sort.label}
                    </PopoverOption>
                ))}
            </PopoverOptions>
            <PopoverFooter
                onReset={() => setDraft(DEFAULT_CAR_SORT)}
                resetDisabled={draft === DEFAULT_CAR_SORT}
                onApply={() => onApply(draft)}
                applyLabel="Apply"
            />
        </>
    )
}

/**
 * A set of checkboxes where nothing ticked means "no filter". `defaultValue` is
 * what Reset goes back to.
 */
export function CheckboxFilter<K extends string>({
    label,
    options,
    value,
    defaultValue,
    onChange,
}: {
    label: string
    options: Record<K, string>
    value: readonly K[]
    defaultValue: readonly K[]
    onChange: (value: K[]) => void
}) {
    return (
        <FilterPopover label={label} count={value.length}>
            {close => (
                <CheckboxPanel
                    options={options}
                    value={value}
                    defaultValue={defaultValue}
                    onApply={next => { onChange(next); close() }}
                />
            )}
        </FilterPopover>
    )
}

function CheckboxPanel<K extends string>({
    options,
    value,
    defaultValue,
    onApply,
}: {
    options: Record<K, string>
    value: readonly K[]
    defaultValue: readonly K[]
    onApply: (value: K[]) => void
}) {
    const keys = Object.keys(options) as K[]
    const [draft, setDraft] = useState<K[]>([...value])
    const toggle = (key: K) => setDraft(d => (d.includes(key) ? d.filter(k => k !== key) : [...d, key]))
    const isDefault = draft.length === defaultValue.length && draft.every(k => defaultValue.includes(k))
    return (
        <>
            <PopoverOptions>
                {keys.map(key => (
                    <PopoverOption key={key} type="checkbox" checked={draft.includes(key)} onChange={() => toggle(key)}>
                        {options[key]}
                    </PopoverOption>
                ))}
            </PopoverOptions>
            <PopoverFooter
                onReset={() => setDraft([...defaultValue])}
                resetDisabled={isDefault}
                // Kept in the options' order, so the URL doesn't depend on click order.
                onApply={() => onApply(keys.filter(k => draft.includes(k)))}
                applyLabel="Show vehicles"
            />
        </>
    )
}

export const DEFAULT_LISTING_FILTER: readonly ListingStatus[] = ['listed']

export function ListingStatusFilter({
    value,
    defaultValue = DEFAULT_LISTING_FILTER,
    onChange,
}: {
    value: readonly ListingStatus[]
    defaultValue?: readonly ListingStatus[]
    onChange: (value: ListingStatus[]) => void
}) {
    return (
        <CheckboxFilter label="Listing Status" options={LISTING_STATUSES} value={value} defaultValue={defaultValue} onChange={onChange} />
    )
}

/** Pick individual cars. Nothing ticked shows them all. */
export function VehicleFilter({
    cars,
    value,
    onChange,
}: {
    cars: readonly FleetCar[]
    value: readonly number[]
    onChange: (ids: number[]) => void
}) {
    // Only count the chosen cars that are still offered, so a car hidden by the
    // listing filter doesn't leave the button reading "(1)" over nothing.
    const offered = value.filter(id => cars.some(c => c.id === id))
    return (
        <FilterPopover label="Vehicle" count={offered.length}>
            {close => <VehiclePanel cars={cars} value={offered} onApply={ids => { onChange(ids); close() }} />}
        </FilterPopover>
    )
}

function VehiclePanel({
    cars,
    value,
    onApply,
}: {
    cars: readonly FleetCar[]
    value: readonly number[]
    onApply: (ids: number[]) => void
}) {
    const [draft, setDraft] = useState<number[]>([...value])
    const sorted = [...cars].sort(compareCarNames)
    const toggle = (id: number) => setDraft(d => (d.includes(id) ? d.filter(x => x !== id) : [...d, id]))
    return (
        <>
            <PopoverOptions>
                {sorted.length === 0 && <p className="py-4 text-sm text-gray-500">No vehicles match the listing filter.</p>}
                {sorted.map(car => (
                    <PopoverOption
                        key={car.id}
                        type="checkbox"
                        checked={draft.includes(car.id)}
                        onChange={() => toggle(car.id)}
                        hint={car.license_plate ?? undefined}
                        leading={
                            <img
                                src={carMainImageUrl(car.id)}
                                alt=""
                                className="h-10 w-16 flex-shrink-0 rounded object-cover"
                                loading="lazy"
                                decoding="async"
                            />
                        }
                    >
                        {car.make} {car.model} {car.year}
                    </PopoverOption>
                ))}
            </PopoverOptions>
            <PopoverFooter
                onReset={() => setDraft([])}
                resetDisabled={draft.length === 0}
                onApply={() => onApply(sorted.filter(c => draft.includes(c.id)).map(c => c.id))}
                applyLabel="Show vehicles"
            />
        </>
    )
}
