import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// The modal frame the payment dialogs share — extending a trip, updating the
// card, an owner's charge, capture and refund.
//
// Same mechanics as CancelTripDialog and AddDriverDialog: Escape to close
// (never mid-request), focus in and back out to the opener, page scroll locked,
// a backdrop click closes. `busy` blocks every way out while money is moving,
// because closing a dialog halfway through a card authentication leaves the
// guest not knowing whether they were charged.
//
// Portalled to <body>, like TripCalendar's sheet. Rendered in place, inside the
// admin shell's own scrolling layout, the backdrop left an undimmed strip along
// the bottom of the screen. At <body> nothing above it can clip or contain it.
// The one thing it would lose is the admin colours — `.admin-shell` redefines
// the colour tokens, and <body> is outside it — so a marker left in place
// checks whether the dialog was opened inside the admin shell and, if so, the
// portal carries the class along.

export function ModalShell({
    title,
    busy = false,
    onClose,
    children,
    footer,
}: {
    title: string
    busy?: boolean
    onClose: () => void
    children: ReactNode
    footer?: ReactNode
}) {
    const overlayRef = useRef<HTMLDivElement>(null)
    const openerRef = useRef<Element | null>(null)
    const markerRef = useRef<HTMLSpanElement>(null)
    // null until mounted: the portal needs `document`, and the theme is read off
    // where the marker landed.
    const [themeClass, setThemeClass] = useState<string | null>(null)

    useEffect(() => {
        setThemeClass(markerRef.current?.closest('.admin-shell') ? 'admin-shell' : '')
    }, [])

    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape' && !busy) onClose()
        }
        document.addEventListener('keydown', handleKey)
        return () => document.removeEventListener('keydown', handleKey)
    }, [onClose, busy])

    useEffect(() => {
        openerRef.current = document.activeElement
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = previousOverflow
            if (openerRef.current instanceof HTMLElement) openerRef.current.focus()
        }
    }, [])

    // Focus once the portal has actually rendered the overlay.
    useEffect(() => {
        if (themeClass !== null) overlayRef.current?.focus()
    }, [themeClass])

    return (
        <>
            <span ref={markerRef} hidden />
            {themeClass !== null && createPortal(
        <div className={themeClass}>
        <div
            ref={overlayRef}
            tabIndex={-1}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !busy) onClose()
            }}
            className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4 focus:outline-none"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className="bg-surface border border-line rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-xl"
            >
                <div className="flex items-start justify-between gap-4 p-5 border-b border-line">
                    <h2 className="text-lg font-bold text-ink">{title}</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        aria-label="Close"
                        className="text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto space-y-4">{children}</div>

                {/* flex-wrap: on a narrow screen the buttons move to a second
                    row rather than squeezing their labels onto two lines. */}
                {footer && <div className="p-5 border-t border-line flex flex-wrap items-center gap-3 justify-end">{footer}</div>}
            </div>
        </div>
        </div>,
                document.body,
            )}
        </>
    )
}

export const dialogInputClass =
    'w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-ink text-sm ' +
    'placeholder:text-ink-400 focus:outline-none focus:border-brand hover:border-ink-400 transition-colors'

export const primaryButtonClass =
    'px-4 py-2.5 rounded-xl bg-brand text-on-brand text-sm font-bold whitespace-nowrap hover:opacity-90 transition-opacity ' +
    'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'

export const secondaryButtonClass =
    'px-4 py-2.5 rounded-xl border border-line text-ink text-sm font-bold whitespace-nowrap hover:bg-subtle transition-colors ' +
    'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'

export function DialogError({ message }: { message: string | null }) {
    if (!message) return null
    return <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-800 text-sm">{message}</div>
}

export function Money({ amount, className }: { amount: number; className?: string }) {
    const sign = amount < 0 ? '−' : ''
    return <span className={className}>{sign}${Math.abs(amount).toFixed(2)}</span>
}