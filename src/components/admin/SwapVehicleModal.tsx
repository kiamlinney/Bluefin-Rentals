import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { getSwapCandidates, swapBookingVehicle } from '@/lib/db'
import { carMainImageUrl } from '@/lib/car-images'
import { formatAverage } from '@/lib/reviews'
import {
    SWAP_REASON_MAX,
    swapReasonError,
    type OriginalSwapCar,
    type SwapCandidate,
    type SwapCar,
} from '@/lib/vehicle-swap'
import { cn } from '@/lib/utils'
import {
    DialogError,
    ModalShell,
    dialogInputClass,
    primaryButtonClass,
    secondaryButtonClass,
} from '@/components/trip/ModalShell'

// Moving a booked trip onto another car, modelled on Turo's "Eligible
// replacements". Two steps: pick a car from the ones free for the whole trip,
// then write the reason the guest is emailed. The server re-checks everything
// (vehicle-swap.server.ts); this list is only what was free when it opened.

type Step = 'choose' | 'reason' | 'done'

const name = (car: SwapCar) => `${car.make} ${car.model} ${car.year}`

export function SwapVehicleModal({
    bookingId,
    currentCar,
    guestName,
    onClose,
    onSwapped,
}: {
    bookingId: string
    currentCar: SwapCar
    guestName: string
    onClose: () => void
    onSwapped: () => void
}) {
    const [step, setStep] = useState<Step>('choose')
    const [candidates, setCandidates] = useState<SwapCandidate[] | null>(null)
    const [original, setOriginal] = useState<OriginalSwapCar | null>(null)
    const [blockedReason, setBlockedReason] = useState<string | null>(null)
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [reason, setReason] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [emailSent, setEmailSent] = useState(false)

    useEffect(() => {
        let cancelled = false
        getSwapCandidates({ data: bookingId })
            .then(result => {
                if (cancelled) return
                setCandidates(result.candidates)
                setOriginal(result.original)
                setBlockedReason(result.blockedReason)
            })
            .catch((e: unknown) => {
                if (cancelled) return
                setCandidates([])
                setError(e instanceof Error ? e.message : 'Could not load the cars.')
            })
        return () => { cancelled = true }
    }, [bookingId])

    const selected =
        (original && !original.unavailableReason && original.id === selectedId ? original : null) ??
        candidates?.find(car => car.id === selectedId) ??
        null

    const swap = async () => {
        if (!selected) return
        const problem = swapReasonError(reason)
        if (problem) {
            setError(problem)
            return
        }
        setWorking(true)
        setError(null)
        try {
            const result = await swapBookingVehicle({ data: { bookingId, toCarId: selected.id, reason } })
            setEmailSent(result.emailSent)
            setStep('done')
            onSwapped()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not swap the vehicle.')
        } finally {
            setWorking(false)
        }
    }

    if (step === 'done' && selected) {
        return (
            <ModalShell
                title="Vehicle swapped"
                onClose={onClose}
                footer={<button type="button" className={primaryButtonClass} onClick={onClose}>Done</button>}
            >
                <p className="text-sm text-ink">
                    This trip is now on the <strong>{name(selected)}</strong>.
                </p>
                {emailSent ? (
                    <p className="text-sm text-muted">{guestName} was emailed the new car and your reason.</p>
                ) : (
                    <DialogError message={`The swap went through, but the email to ${guestName} did not send. Let them know directly.`} />
                )}
            </ModalShell>
        )
    }

    if (step === 'reason' && selected) {
        return (
            <ModalShell
                title="Why are you swapping?"
                busy={working}
                onClose={onClose}
                wide
                footer={
                    <>
                        <button
                            type="button"
                            className={secondaryButtonClass}
                            disabled={working}
                            onClick={() => { setStep('choose'); setError(null) }}
                        >
                            Back
                        </button>
                        <button
                            type="button"
                            className={primaryButtonClass}
                            disabled={working || !reason.trim()}
                            onClick={swap}
                        >
                            {working ? 'Swapping…' : 'Swap vehicle'}
                        </button>
                    </>
                }
            >
                <p className="text-sm text-ink">
                    Swapping the <strong>{name(currentCar)}</strong> for the <strong>{name(selected)}</strong>.
                </p>
                <label className="block space-y-1.5">
                    <span className="text-sm font-semibold text-ink">Reason. This is emailed to {guestName}.</span>
                    <textarea
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        maxLength={SWAP_REASON_MAX}
                        rows={5}
                        autoFocus
                        placeholder="e.g. The car you booked needs a repair before your trip, so we've moved you to one just as good."
                        className={cn(dialogInputClass, 'resize-none')}
                    />
                </label>
                <p className="text-xs text-muted">
                    The email includes the new car, your reason and the new car's lockbox code if the deposit hold is
                    already in place. Their price and per-mile rate stay the same.
                </p>
                <DialogError message={error} />
            </ModalShell>
        )
    }

    return (
        <ModalShell
            title="Eligible replacements"
            onClose={onClose}
            wide
            footer={
                <button
                    type="button"
                    className={primaryButtonClass}
                    disabled={!selected}
                    onClick={() => { setStep('reason'); setError(null) }}
                >
                    Continue
                </button>
            }
        >
            <p className="text-sm text-ink">
                These cars are free for the whole trip, including the turnaround time either side.
            </p>

            {candidates === null ? (
                <p className="text-sm text-muted">Checking which cars are free…</p>
            ) : blockedReason ? (
                <DialogError message={blockedReason} />
            ) : (
                // One radiogroup across both sections, so arrow keys move
                // between the original car and the rest.
                <div className="space-y-4" role="radiogroup" aria-label="Replacement vehicle">
                    {/* The car the trip was booked on, set apart at the top:
                        swapping back is the move an owner looks for first.
                        Shown even when it can't be picked, with the reason,
                        rather than silently missing. */}
                    {original && (
                        <div className="space-y-3 pb-4 border-b border-line">
                            <h3 className="text-sm font-bold text-ink">Original vehicle</h3>
                            <CarOption
                                car={original}
                                checked={original.id === selectedId}
                                disabledReason={original.unavailableReason}
                                onSelect={() => setSelectedId(original.id)}
                            />
                        </div>
                    )}

                    <h3 className="text-sm font-bold text-ink">
                        {original ? 'Other eligible vehicles' : 'Eligible vehicles'} ({candidates.length})
                    </h3>
                    {candidates.length === 0 && !error && (
                        <p className="text-sm text-muted">No other car is free for these dates.</p>
                    )}
                    <div className="space-y-3">
                        {candidates.map(car => (
                            <CarOption
                                key={car.id}
                                car={car}
                                checked={car.id === selectedId}
                                onSelect={() => setSelectedId(car.id)}
                            />
                        ))}
                    </div>
                </div>
            )}
            <DialogError message={error} />
        </ModalShell>
    )
}

/** One radio card: name, trim and plate, rating, photo. */
function CarOption({
    car,
    checked,
    disabledReason = null,
    onSelect,
}: {
    car: SwapCandidate
    checked: boolean
    /** Set when the car is shown but can't be picked. */
    disabledReason?: string | null
    onSelect: () => void
}) {
    const disabled = disabledReason !== null
    const details = [car.trim, car.license_plate].filter(Boolean).join(' • ')
    return (
        <label
            className={cn(
                'flex items-center gap-3 rounded-xl border p-3 transition-colors',
                disabled
                    ? 'border-line cursor-not-allowed'
                    : checked ? 'border-ink bg-subtle cursor-pointer' : 'border-line hover:bg-subtle cursor-pointer',
            )}
        >
            <input
                type="radio"
                name="swap-car"
                checked={checked}
                disabled={disabled}
                onChange={onSelect}
                className="h-5 w-5 shrink-0 accent-current cursor-pointer disabled:cursor-not-allowed"
            />
            <div className={cn('min-w-0 flex-1', disabled && 'opacity-60')}>
                <p className="font-semibold text-ink">{name(car)}</p>
                {details && <p className="text-xs text-muted">{details}</p>}
                <p className="text-xs text-ink flex items-center gap-1 mt-0.5">
                    {car.rating !== null && (
                        <>
                            <span className="font-semibold">{formatAverage(car.rating)}</span>
                            <Star size={12} className="fill-current" />
                        </>
                    )}
                    <span className="text-muted">
                        ({car.completedTrips} {car.completedTrips === 1 ? 'trip' : 'trips'})
                    </span>
                </p>
                {disabledReason && <p className="text-xs text-red-700 mt-1">{disabledReason}</p>}
            </div>
            <img
                src={carMainImageUrl(car.id)}
                alt=""
                className={cn('w-28 h-16 object-cover rounded-md border border-line shrink-0', disabled && 'opacity-60 grayscale')}
                loading="lazy"
                decoding="async"
            />
        </label>
    )
}
