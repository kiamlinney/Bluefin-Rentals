import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

// A toolbar button that opens a panel of choices, Turo-style: the choices are a
// draft until the panel's own button applies them, and Reset puts the draft
// back to the default. The panel's content mounts each time it opens, so a
// panel component can seed its draft from the applied value with a plain
// useState and an abandoned draft is simply forgotten.

const GUTTER = 12 // px kept clear of the viewport edge

export function FilterPopover({
    label,
    count = 0,
    children,
}: {
    label: string
    /** Shown as "Label (n)", and the button turns dark, while above zero. */
    count?: number
    children: (close: () => void) => ReactNode
}) {
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const [shift, setShift] = useState(0)

    useEffect(() => {
        if (!open) return
        const onPointer = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onPointer)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onPointer)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    // Anchored under the button's left edge, and nudged left if that would run
    // it off the right side of the screen (the last button on a phone).
    useLayoutEffect(() => {
        if (!open || !panelRef.current) return
        const rect = panelRef.current.getBoundingClientRect()
        const overflow = rect.right - shift - (window.innerWidth - GUTTER)
        setShift(overflow > 0 ? -overflow : 0)
    }, [open])

    const active = count > 0

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className={cn(
                    'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm cursor-pointer whitespace-nowrap',
                    active
                        ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                )}
            >
                {label}
                {active && ` (${count})`}
                {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {open && (
                <div
                    ref={panelRef}
                    style={{ transform: `translateX(${shift}px)` }}
                    className="absolute left-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-gray-200 bg-white shadow-lg"
                >
                    {children(() => setOpen(false))}
                </div>
            )}
        </div>
    )
}

/** The scrolling list of choices inside a panel. */
export function PopoverOptions({ children }: { children: ReactNode }) {
    return <div className="max-h-[min(26rem,60dvh)] overflow-y-auto px-4 py-1">{children}</div>
}

/** One choice: a whole-row label with a radio or a checkbox on the right. */
export function PopoverOption({
    type,
    checked,
    onChange,
    children,
    hint,
    leading,
}: {
    type: 'radio' | 'checkbox'
    checked: boolean
    onChange: () => void
    children: ReactNode
    hint?: string
    leading?: ReactNode
}) {
    return (
        <label className="flex cursor-pointer items-center gap-3 border-b border-gray-100 py-3 last:border-b-0">
            {leading}
            <span className="min-w-0 flex-1">
                <span className="block text-sm text-gray-900">{children}</span>
                {hint && <span className="block text-xs text-gray-500">{hint}</span>}
            </span>
            <input type={type} checked={checked} onChange={onChange} className="sr-only" />
            {type === 'radio' ? (
                <span
                    aria-hidden
                    className={cn(
                        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2',
                        checked ? 'border-gray-900' : 'border-gray-300',
                    )}
                >
                    {checked && <span className="h-2.5 w-2.5 rounded-full bg-gray-900" />}
                </span>
            ) : (
                <span
                    aria-hidden
                    className={cn(
                        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2',
                        checked ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300',
                    )}
                >
                    {checked && <Check size={14} strokeWidth={3} />}
                </span>
            )}
        </label>
    )
}

/** Reset on the left, the apply button on the right. */
export function PopoverFooter({
    onReset,
    resetDisabled,
    onApply,
    applyLabel,
}: {
    onReset: () => void
    resetDisabled: boolean
    onApply: () => void
    applyLabel: string
}) {
    return (
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
            <button
                type="button"
                onClick={onReset}
                disabled={resetDisabled}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-default disabled:text-gray-300 disabled:hover:bg-transparent cursor-pointer"
            >
                Reset
            </button>
            <button
                type="button"
                onClick={onApply}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 cursor-pointer"
            >
                {applyLabel}
            </button>
        </div>
    )
}
