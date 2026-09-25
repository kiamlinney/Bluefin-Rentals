import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { carMainImageUrl } from '@/lib/car-images.ts'
import { formatBusinessDate } from '@/lib/dates.ts'
import { pickupDisplayName } from './TripLocation'
import type { Car } from '@/types.ts'

// The "your trip is booked" confirmation, shown once on arrival from checkout.
//
// It sits on top of the trip page rather than replacing it — same reasoning as
// PhotoGallery — so dismissing it leaves the guest on the permanent page for
// their trip instead of somewhere they have to navigate back from.
//
// No QR code and no "next steps": there is no app to download, and the arrival
// instructions are in the Messages section on the page behind this and in the
// email that has just been sent.

const DATE_FORMAT = { month: 'short', day: 'numeric', year: 'numeric' } as const

export function BookedTripModal({
    car,
    startTime,
    endTime,
    pickupLocation,
    onClose,
}: {
    car: Car
    startTime: string
    endTime: string
    pickupLocation: string
    onClose: () => void
}) {
    const overlayRef = useRef<HTMLDivElement>(null)
    const openerRef = useRef<Element | null>(null)

    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', handleKey)
        return () => document.removeEventListener('keydown', handleKey)
    }, [onClose])

    // Same focus and scroll handling as the other dialogs, so keyboard users
    // land inside it and come back out where they started.
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

    return (
        <div
            ref={overlayRef}
            tabIndex={-1}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose()
            }}
            className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4 focus:outline-none"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="booked-title"
                className="bg-surface border border-line rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl"
            >
                <div className="flex items-start justify-between gap-4 p-5 pb-0">
                    <h2 id="booked-title" className="text-2xl font-bold text-ink">
                        Your trip is booked!
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="text-muted hover:text-ink transition-colors cursor-pointer shrink-0 mt-1"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <img
                        src={carMainImageUrl(car.id)}
                        alt={`${car.make} ${car.model} ${car.year}`}
                        className="w-full aspect-[5/3] object-cover rounded-xl border border-line"
                        decoding="async"
                    />

                    <div className="border border-line rounded-xl p-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                            Your booked trip
                        </h3>
                        <p className="text-lg font-bold text-ink mt-1">
                            {car.make} {car.model} {car.year}
                        </p>
                        <p className="text-muted mt-1">
                            {formatBusinessDate(startTime, DATE_FORMAT)} –{' '}
                            {formatBusinessDate(endTime, DATE_FORMAT)}
                        </p>
                        <p className="text-muted">{pickupDisplayName(pickupLocation)}</p>
                    </div>

                    <p className="text-sm text-muted">
                        We've emailed your confirmation and pickup instructions. They're on this
                        page too, any time you need them.
                    </p>

                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full py-3 rounded-xl bg-brand text-on-brand font-bold hover:bg-pine-800 transition-colors cursor-pointer"
                    >
                        View trip details
                    </button>
                </div>
            </div>
        </div>
    )
}
