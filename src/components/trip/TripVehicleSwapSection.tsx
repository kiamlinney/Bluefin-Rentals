import { formatBusinessDateTime } from '@/lib/dates'
import { carName } from '@/lib/email-template'
import type { VehicleSwap } from '@/lib/vehicle-swap'
import { TripSection } from './TripSection'

// Every time an owner moved this trip onto another car, and why. Shared by the
// guest trip page and the admin reservation page so they tell the same story.
// The guest was emailed the same reason when it happened. Renders nothing for a
// trip that was never swapped.

export function TripVehicleSwapSection({
    swaps,
    voice,
}: {
    swaps: VehicleSwap[]
    voice: 'guest' | 'host'
}) {
    if (!swaps.length) return null

    return (
        <TripSection title={swaps.length > 1 ? 'Vehicle changes' : 'Vehicle change'}>
            <ul className="space-y-3">
                {swaps.map(swap => (
                    <li key={swap.id} className="space-y-0.5">
                        <p className="text-ink">
                            {voice === 'guest' ? 'We moved your trip from the ' : 'Swapped from the '}
                            <span className="font-semibold">{carName(swap.from_car)}</span> to the{' '}
                            <span className="font-semibold">{carName(swap.to_car)}</span>
                        </p>
                        <p className="text-sm text-muted">{formatBusinessDateTime(swap.created_at)}</p>
                        <p className="text-sm text-muted whitespace-pre-line max-w-md">
                            {voice === 'guest' ? 'Why: ' : 'Reason sent to the guest: '}
                            {swap.reason}
                        </p>
                    </li>
                ))}
            </ul>
            {voice === 'guest' && (
                <p className="text-sm text-muted max-w-md">Your price and per-mile rate stayed the same.</p>
            )}
        </TripSection>
    )
}
