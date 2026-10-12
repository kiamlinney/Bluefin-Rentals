import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import type { Car, TuroBooking } from '@/types.ts'
import { assignTuroTripCar, getTuroSwapOptions, previewTuroSwap } from '@/lib/db'
import { carMainImageUrl } from '@/lib/car-images'
import { isTuroSwapPending, nextSwapToPrompt, turoReservationUrl, turoSwapKey } from '@/lib/turo-swap'
import type { TuroSwapCarOption } from '@/lib/turo-swap.server'
import { cn } from '@/lib/utils'
import { DialogError, ModalShell, primaryButtonClass } from '@/components/trip/ModalShell'
import { shortDates } from '@/components/admin/useScheduleFlags'

// A Turo trip whose vehicle swap was accepted: Turo's email doesn't say which
// car it moved to, so an owner picks it here (see src/lib/turo-swap.ts). Laid
// out like SwapVehicleModal, with one difference: a car that's busy at the
// same time is shown with a warning but can still be picked, because Turo has
// already put the guest in it. The calendar then flags the overlap.

const name = (car: { make: string; model: string; year: number }) => `${car.make} ${car.model} ${car.year}`

export function TuroSwapModal({
    trip,
    currentCar,
    onClose,
    onSaved,
}: {
    trip: TuroBooking
    currentCar: Car | undefined
    /** Closed without picking a car. */
    onClose: () => void
    /** Closed after picking one; reloads the page's data. */
    onSaved: () => Promise<void>
}) {
    const [options, setOptions] = useState<TuroSwapCarOption[] | null>(null)
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState<{ car: TuroSwapCarOption; clashes: string[] } | null>(null)

    useEffect(() => {
        let cancelled = false
        getTuroSwapOptions({ data: trip.id })
            .then(result => { if (!cancelled) setOptions(result.options) })
            .catch((e: unknown) => {
                if (cancelled) return
                setOptions([])
                setError(e instanceof Error ? e.message : 'Could not load the cars.')
            })
        return () => { cancelled = true }
    }, [trip.id])

    const selected = options?.find(car => car.id === selectedId) ?? null
    const tripLabel = trip.turo_trip_id ? `Turo trip #${trip.turo_trip_id}` : 'Turo trip'

    const save = async () => {
        if (!selected) return
        setWorking(true)
        setError(null)
        try {
            const result = await assignTuroTripCar({ data: { turoBookingId: trip.id, carId: selected.id } })
            setSaved({ car: selected, clashes: result.clashes })
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not save the car.')
        } finally {
            setWorking(false)
        }
    }

    const finish = async () => {
        setWorking(true)
        await onSaved()
    }

    if (saved) {
        return (
            <ModalShell
                title="Car saved"
                busy={working}
                onClose={finish}
                footer={<button type="button" className={primaryButtonClass} disabled={working} onClick={finish}>Done</button>}
            >
                <p className="text-sm text-ink">
                    {tripLabel} is now on the <strong>{name(saved.car)}</strong>, and blocks that car on the site.
                </p>
                {saved.clashes.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-800 text-sm space-y-1">
                        <p className="font-semibold">It overlaps another trip on that car:</p>
                        {saved.clashes.map(clash => <p key={clash}>{clash}</p>)}
                        <p>The owners have been emailed. One of the two has to move.</p>
                    </div>
                )}
            </ModalShell>
        )
    }

    return (
        <ModalShell
            title="Which car did this Turo trip swap to?"
            busy={working}
            onClose={onClose}
            wide
            footer={
                <button type="button" className={primaryButtonClass} disabled={!selected || working} onClick={save}>
                    {working ? 'Saving…' : 'Save car'}
                </button>
            }
        >
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-900 text-sm space-y-1">
                <p>
                    <strong>{trip.renter_name ?? 'The guest'}</strong> accepted the vehicle swap for {tripLabel}{' '}
                    ({shortDates(trip.start_time, trip.end_time)}). Turo's email doesn't say which car it moved to.
                </p>
                <p>
                    Until you pick, the {currentCar ? name(currentCar) : 'original car'} stays blocked and the new car
                    can still be booked here.
                </p>
                {trip.turo_trip_id && (
                    <a
                        href={turoReservationUrl(trip.turo_trip_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold underline"
                    >
                        Check the trip on Turo <ExternalLink size={13} />
                    </a>
                )}
            </div>

            {options === null ? (
                <p className="text-sm text-muted">Loading cars…</p>
            ) : (
                <div className="space-y-3" role="radiogroup" aria-label="The car the trip is on now">
                    {options.map(car => (
                        <CarOption
                            key={car.id}
                            car={car}
                            checked={car.id === selectedId}
                            onSelect={() => setSelectedId(car.id)}
                        />
                    ))}
                </div>
            )}
            <DialogError message={error} />
        </ModalShell>
    )
}

function CarOption({ car, checked, onSelect }: { car: TuroSwapCarOption; checked: boolean; onSelect: () => void }) {
    const details = [car.trim, car.license_plate].filter(Boolean).join(' • ')
    return (
        <label
            className={cn(
                'flex items-center gap-3 rounded-xl border p-3 transition-colors cursor-pointer',
                checked ? 'border-ink bg-subtle' : 'border-line hover:bg-subtle',
            )}
        >
            <input
                type="radio"
                name="turo-swap-car"
                checked={checked}
                onChange={onSelect}
                className="h-5 w-5 shrink-0 accent-current cursor-pointer"
            />
            <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">
                    {name(car)}
                    {car.isCurrent && <span className="ml-2 text-xs font-normal text-muted">(original car)</span>}
                </p>
                {details && <p className="text-xs text-muted">{details}</p>}
                {car.clashes.map(clash => (
                    <p key={clash} className="text-xs text-red-700 mt-1 flex items-start gap-1">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Overlaps {clash}
                    </p>
                ))}
            </div>
            <img
                src={carMainImageUrl(car.id)}
                alt=""
                className="w-28 h-16 object-cover rounded-md border border-line shrink-0"
                loading="lazy"
                decoding="async"
            />
        </label>
    )
}

/**
 * The swap prompt for a page: the dialog opens by itself for the first pending
 * swap (one at a time, the next after each save), and `open` lets a flag open
 * it for a particular trip. Closing it without saving stops it opening by
 * itself again until the page is next visited.
 */
export function useTuroSwapPrompt(turoBookings: TuroBooking[], cars: Car[]) {
    const router = useRouter()
    const [active, setActive] = useState<TuroBooking | null>(null)
    const [dismissed, setDismissed] = useState(false)
    // Swaps settled on this page, so they can't reopen from the old data the
    // page still holds while it reloads (see nextSwapToPrompt).
    const [settledKeys, setSettledKeys] = useState<ReadonlySet<string>>(() => new Set())

    const next = nextSwapToPrompt(turoBookings, settledKeys)

    useEffect(() => {
        if (!dismissed && !active && next) setActive(next)
    }, [dismissed, active, next])

    const modal: ReactNode = active && (
        <TuroSwapModal
            key={active.id}
            trip={active}
            currentCar={cars.find(car => car.id === active.car_id)}
            onClose={() => {
                setActive(null)
                setDismissed(true)
            }}
            onSaved={async () => {
                setSettledKeys(keys => new Set(keys).add(turoSwapKey(active)))
                await router.invalidate()
                setActive(null)
            }}
        />
    )

    return { open: setActive, modal }
}

/** The amber flag on the calendar and the Booked tab, one line per pending swap. */
export function TuroSwapBanner({
    pending,
    cars,
    onOpen,
}: {
    pending: TuroBooking[]
    cars: Car[]
    onOpen: (trip: TuroBooking) => void
}) {
    if (pending.length === 0) return null
    return (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex items-center gap-2 font-bold">
                <AlertTriangle size={16} />
                {pending.length === 1 ? 'A Turo swap needs a car' : `${pending.length} Turo swaps need a car`}
            </p>
            <ul className="mt-2 space-y-1">
                {pending.map(trip => {
                    const car = cars.find(c => c.id === trip.car_id)
                    return (
                        <li key={trip.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>
                                {trip.turo_trip_id ? `Turo #${trip.turo_trip_id}` : 'Turo trip'} · {trip.renter_name ?? 'Turo guest'} ·{' '}
                                {shortDates(trip.start_time, trip.end_time)} · swapped off the {car ? name(car) : 'original car'}
                            </span>
                            <button
                                type="button"
                                onClick={() => onOpen(trip)}
                                className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-amber-600 cursor-pointer"
                            >
                                Choose car
                            </button>
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}

/**
 * Dev server only (renders nothing in a production build): flags one of the
 * real upcoming Turo trips as if Turo had emailed a swap acceptance, through
 * the sync's own code (previewTuroSwap → flagTuroSwap). Shows the whole thing
 * end to end: the IMPORTANT email, the banners, the calendar flag and the
 * dialog, which opens by itself once the page reloads.
 */
export function TuroSwapPreview({ turoBookings, cars }: { turoBookings: TuroBooking[]; cars: Car[] }) {
    const router = useRouter()
    const [tripId, setTripId] = useState('')
    const [working, setWorking] = useState(false)
    const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

    if (!import.meta.env.DEV) return null

    // Trips Turo could still email a swap for: not over, with a reservation id,
    // and not already waiting on a car.
    const now = Date.now()
    const eligible = turoBookings.filter(t =>
        t.turo_trip_id && new Date(t.end_time).getTime() > now && !isTuroSwapPending(t),
    )

    async function preview() {
        if (!tripId) return
        setWorking(true)
        setMessage(null)
        try {
            const outcome = await previewTuroSwap({ data: tripId })
            if (outcome.result === 'flagged') {
                setMessage({ tone: 'ok', text: 'Flagged, and the IMPORTANT email was sent to the owners. The dialog opens now.' })
                setTripId('')
                await router.invalidate()
            } else if (outcome.result === 'emailFailed') {
                setMessage({ tone: 'error', text: `The email did not send, so nothing was flagged: ${outcome.error}` })
            } else {
                setMessage({ tone: 'error', text: 'Nothing to flag: the trip is over, gone, or already flagged.' })
            }
        } catch (e: unknown) {
            setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Preview failed.' })
        } finally {
            setWorking(false)
        }
    }

    const carName = (id: number) => {
        const car = cars.find(c => c.id === id)
        return car ? name(car) : `car ${id}`
    }

    return (
        <div className="mb-6 rounded-lg border border-dashed border-gray-300 p-3 text-sm space-y-2">
            <p className="font-semibold">Preview a Turo swap <span className="font-normal text-gray-500">(dev server only)</span></p>
            <p className="text-gray-600">
                Acts as if Turo had just emailed "accepted your vehicle swap request" for this trip: the owners get the
                real email and the dialog opens. To undo, pick the car the trip is already on.
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <select
                    value={tripId}
                    onChange={e => setTripId(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 max-w-full"
                >
                    <option value="">{eligible.length ? 'Choose an upcoming Turo trip' : 'No upcoming Turo trips'}</option>
                    {eligible.map(t => (
                        <option key={t.id} value={t.id}>
                            #{t.turo_trip_id} · {t.renter_name ?? 'Turo guest'} · {carName(t.car_id)} · {shortDates(t.start_time, t.end_time)}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={preview}
                    disabled={!tripId || working}
                    className="px-3 py-2 border rounded-lg disabled:opacity-50 cursor-pointer"
                >
                    {working ? 'Flagging…' : 'Preview swap'}
                </button>
            </div>
            {message && (
                <p className={message.tone === 'ok' ? 'text-green-700' : 'text-red-700'}>{message.text}</p>
            )}
        </div>
    )
}
