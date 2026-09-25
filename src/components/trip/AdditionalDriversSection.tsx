import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { UserPlus, X } from 'lucide-react'
import { removeAdditionalDriver } from '@/lib/db'
import { MAX_ADDITIONAL_DRIVERS, type TripDriver } from '@/lib/additional-drivers.ts'
import { TripSection } from './TripSection'
import { AddDriverDialog } from './AddDriverDialog'

// Extra drivers on a trip, shown to both sides.
//
// `voice` swaps the copy rather than the component: the guest is told what
// their driver may do, the host is told what to check at pickup. One component
// so the two views cannot disagree about who is on a trip.

export function AdditionalDriversSection({
    bookingId,
    drivers,
    voice,
    canManage,
}: {
    bookingId: string
    drivers: TripDriver[]
    voice: 'guest' | 'host'
    /** False once the trip has started, or for a trip that isn't confirmed. */
    canManage: boolean
}) {
    const router = useRouter()
    const [adding, setAdding] = useState(false)
    const [removingId, setRemovingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const remove = async (driverId: string) => {
        setRemovingId(driverId)
        setError(null)
        try {
            await removeAdditionalDriver({ data: { driverId } })
            // invalidate() rather than a reload: the loader refetches and the
            // list re-renders in place, keeping scroll position.
            await router.invalidate()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not remove that driver.')
        } finally {
            setRemovingId(null)
        }
    }

    const atLimit = drivers.length >= MAX_ADDITIONAL_DRIVERS

    return (
        <TripSection
            title="Additional drivers"
            action={
                voice === 'guest' && canManage && !atLimit ? (
                    <button
                        type="button"
                        onClick={() => setAdding(true)}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-pine-500 hover:underline cursor-pointer"
                    >
                        <UserPlus size={14} />
                        Add a driver
                    </button>
                ) : undefined
            }
        >
            <p className="text-sm text-muted">
                {voice === 'guest'
                    ? "They can drive on this trip once approved, but can't pick the car up or drop it off without you. You must be present for pickup and drop-off."
                    : 'Check each licence at pickup. Nothing about these drivers has been verified online.'}
            </p>

            {drivers.length === 0 ? (
                <p className="text-ink">
                    {voice === 'guest' ? 'No one else is on this trip.' : '- -'}
                </p>
            ) : (
                <ul className="divide-y divide-line border border-line rounded-xl mt-2">
                    {drivers.map((driver) => (
                        <li key={driver.id} className="flex items-center justify-between gap-4 px-4 py-3">
                            <div className="min-w-0">
                                <p className="text-ink font-medium truncate">{driver.full_name}</p>
                                <p className="text-sm text-muted truncate">{driver.email}</p>
                                {/* Only the host needs the date of birth — it's
                                    what they check the licence against. The guest
                                    typed it and doesn't need it read back. */}
                                {voice === 'host' && (
                                    <p className="text-sm text-muted">Born {driver.date_of_birth}</p>
                                )}
                            </div>

                            {canManage && voice === 'guest' && (
                                <button
                                    type="button"
                                    onClick={() => remove(driver.id)}
                                    disabled={removingId === driver.id}
                                    aria-label={`Remove ${driver.full_name}`}
                                    className="shrink-0 text-muted hover:text-red-700 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    <X size={18} />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {atLimit && voice === 'guest' && canManage && (
                <p className="text-sm text-muted">
                    That's the maximum of {MAX_ADDITIONAL_DRIVERS} extra drivers for a trip.
                </p>
            )}

            {error && <p className="text-sm text-red-700">{error}</p>}

            {adding && (
                <AddDriverDialog
                    bookingId={bookingId}
                    onClose={() => setAdding(false)}
                    onAdded={() => {
                        setAdding(false)
                        void router.invalidate()
                    }}
                />
            )}
        </TripSection>
    )
}
