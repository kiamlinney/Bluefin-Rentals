import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { decideTripExtra, type TripExtraRow } from '@/lib/db'
import { TripSection } from './TripSection'

// What a trip has, and what has been asked for — on both the guest page and the
// host's, from one component so the two cannot disagree.
//
// This was the missing half of the extras feature: the money was charged and
// stored, the receipt itemised it, but neither reservation page ever said what
// was on the trip. A guest could only infer it from the mileage line saying
// "Unlimited", and would then be offered unlimited mileage again on the form.
//
// Rows are read from booking_extras and carry their own snapshotted name and
// price, so an extra retired from the catalogue still renders as what was
// actually bought. Declined rows never reach here — loadTripExtras filters them.

const formatMoney = (amount: number): string => `$${amount.toFixed(2)}`

/** What the row means, in the reader's own terms. */
function statusNote(extra: TripExtraRow, voice: 'guest' | 'host'): string | null {
    if (extra.status === 'requested') {
        return voice === 'host' ? 'Requested · needs your answer' : 'Requested · awaiting confirmation'
    }
    // Approved but unpaid is the normal state for anything added after booking:
    // there is no saved card, so it is settled in person. Said on both sides so
    // the host remembers to collect and the guest expects to pay.
    if (!extra.charged) {
        return voice === 'host' ? 'Approved · collect at pickup' : 'Approved · pay at pickup'
    }
    return null
}

export function TripExtrasSection({
    bookingId,
    extras,
    voice,
    canRequestMore,
}: {
    bookingId: string
    extras: TripExtraRow[]
    voice: 'guest' | 'host'
    /** False once the trip has started, or for a trip that isn't confirmed. */
    canRequestMore: boolean
}) {
    const router = useRouter()
    const [working, setWorking] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const decide = async (extraId: string, approve: boolean) => {
        setWorking(extraId)
        setError(null)
        try {
            await decideTripExtra({ data: { extraId, approve } })
            await router.invalidate()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not update that extra.')
        } finally {
            setWorking(null)
        }
    }

    return (
        <TripSection
            title="Extras"
            action={
                voice === 'guest' && canRequestMore ? (
                    <Link
                        to="/trips/$bookingId/extras"
                        params={{ bookingId }}
                        className="text-sm font-semibold text-pine-500 hover:underline"
                    >
                        Request extras
                    </Link>
                ) : undefined
            }
        >
            {extras.length === 0 ? (
                <p className="text-ink">
                    {voice === 'guest' ? 'No extras on this trip.' : '- -'}
                </p>
            ) : (
                <ul className="divide-y divide-line border border-line rounded-xl">
                    {extras.map((extra) => {
                        const note = statusNote(extra, voice)
                        const pending = extra.status === 'requested'

                        return (
                            <li key={extra.id} className="px-4 py-3">
                                <div className="flex items-baseline justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="text-ink font-medium">{extra.name}</p>
                                        {extra.billing === 'per-day' && (
                                            <p className="text-sm text-muted">
                                                {extra.quantity} {extra.quantity === 1 ? 'day' : 'days'} ×{' '}
                                                {formatMoney(extra.unit_price)}
                                            </p>
                                        )}
                                        {note && <p className="text-sm text-muted">{note}</p>}
                                    </div>
                                    <span className="text-ink tabular-nums shrink-0">
                                        {formatMoney(extra.amount)}
                                    </span>
                                </div>

                                {/* Answering lives with the request rather than
                                    in a separate queue — the reservation page is
                                    where the trip's context already is. */}
                                {voice === 'host' && pending && (
                                    <div className="flex items-center gap-3 mt-3">
                                        <button
                                            type="button"
                                            onClick={() => decide(extra.id, true)}
                                            disabled={working === extra.id}
                                            className="px-3 py-1.5 rounded-lg bg-brand text-on-brand text-sm font-bold hover:bg-pine-800 transition-colors cursor-pointer disabled:opacity-50"
                                        >
                                            {working === extra.id ? '…' : 'Approve'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => decide(extra.id, false)}
                                            disabled={working === extra.id}
                                            className="px-3 py-1.5 rounded-lg border border-line text-ink text-sm font-bold hover:bg-subtle transition-colors cursor-pointer disabled:opacity-50"
                                        >
                                            Decline
                                        </button>
                                    </div>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}

            {error && <p className="text-sm text-red-700">{error}</p>}
        </TripSection>
    )
}
