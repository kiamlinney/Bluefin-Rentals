import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { addAdditionalDriver } from '@/lib/db'
import {
    MIN_DRIVER_AGE_YEARS,
    validateDriver,
} from '@/lib/additional-drivers.ts'

// Adding a second driver to a trip.
//
// Modal mechanics are CancelTripDialog's, deliberately: Escape to close (never
// mid-request), focus in and back out to the opener, page scroll locked. This
// takes typed input, so losing focus to the page behind it matters here for the
// same reason it does there.

const inputClass =
    'w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-ink text-sm ' +
    'placeholder:text-ink-400 focus:outline-none focus:border-brand hover:border-ink-400 transition-colors'

function Field({
    label,
    children,
}: {
    label: string
    children: React.ReactNode
}) {
    return (
        <label className="block">
            <span className="block text-sm font-semibold text-ink mb-1.5">{label}</span>
            {children}
        </label>
    )
}

export function AddDriverDialog({
    bookingId,
    onClose,
    onAdded,
}: {
    bookingId: string
    onClose: () => void
    onAdded: () => void
}) {
    const [fullName, setFullName] = useState('')
    const [email, setEmail] = useState('')
    const [dateOfBirth, setDateOfBirth] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const overlayRef = useRef<HTMLDivElement>(null)
    const openerRef = useRef<Element | null>(null)

    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape' && !working) onClose()
        }
        document.addEventListener('keydown', handleKey)
        return () => document.removeEventListener('keydown', handleKey)
    }, [onClose, working])

    useEffect(() => {
        openerRef.current = document.activeElement
        overlayRef.current?.focus()
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = previousOverflow
            if (openerRef.current instanceof HTMLElement) openerRef.current.focus()
        }
    }, [])

    const submit = async () => {
        // Validated here purely so an obvious mistake doesn't cost a round trip.
        // The server runs the same function and its answer is the one that
        // counts — this copy can be skipped entirely and nothing changes.
        const validation = validateDriver({ fullName, email, dateOfBirth })
        if (!validation.ok) {
            setError(validation.error)
            return
        }

        setWorking(true)
        setError(null)
        try {
            await addAdditionalDriver({ data: { bookingId, ...validation.value } })
            onAdded()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not add that driver.')
            setWorking(false)
        }
    }

    return (
        <div
            ref={overlayRef}
            tabIndex={-1}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !working) onClose()
            }}
            className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4 focus:outline-none"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-driver-title"
                className="bg-surface border border-line rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-xl"
            >
                <div className="flex items-start justify-between gap-4 p-5 border-b border-line">
                    <h2 id="add-driver-title" className="text-lg font-bold text-ink">
                        Add a driver
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={working}
                        aria-label="Close"
                        className="text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto space-y-4">
                    <p className="text-sm text-muted">
                        They can drive on this trip once approved, but can't pick the car up or drop
                        it off without you. You must be present for pickup and drop-off.
                    </p>

                    <Field label="Full name">
                        <input
                            className={inputClass}
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="As printed on their licence"
                            autoComplete="off"
                        />
                    </Field>

                    <Field label="Email address">
                        <input
                            className={inputClass}
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="driver@example.com"
                            autoComplete="off"
                        />
                    </Field>

                    <Field label="Date of birth">
                        <input
                            className={inputClass}
                            type="date"
                            value={dateOfBirth}
                            onChange={(e) => setDateOfBirth(e.target.value)}
                        />
                    </Field>

                    {/* Said plainly rather than discovered on rejection: the age
                        floor is the only automatic gate on who may be added. */}
                    <p className="text-sm text-muted">
                        Drivers must be at least {MIN_DRIVER_AGE_YEARS}. Bring their licence to
                        pickup — we check it in person.
                    </p>

                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
                            {error}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-3 p-5 border-t border-line">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={working}
                        className="px-4 py-2.5 text-sm font-semibold text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={working}
                        className="px-4 py-2.5 rounded-xl bg-brand text-on-brand text-sm font-bold hover:bg-pine-800 transition-colors cursor-pointer disabled:opacity-50"
                    >
                        {working ? 'Adding…' : 'Add driver'}
                    </button>
                </div>
            </div>
        </div>
    )
}
