import { useState } from 'react'
import { decideTripExtension } from '@/lib/payments'
// Type-only, so it's erased from the browser bundle.
import type { ExtensionRow } from '@/lib/payments.server'
import { formatBusinessDateTime } from '@/lib/dates'
import { TripSection } from './TripSection'
import { DialogError, Money } from './ModalShell'

// A trip's extensions, on both reservation pages. An owner answers a last-hour
// request here (ImportantFiles/extensions.md): approve charges the card
// hold and moves the trip's end; decline releases the hold.

const STATUS_TEXT: Record<ExtensionRow['status'], string> = {
    pending: 'Awaiting payment',
    requested: 'Awaiting Bluefin',
    confirmed: 'Confirmed',
    declined: 'Declined',
    expired: 'Not completed',
    failed: 'Payment failed',
    canceled: 'Canceled',
}

export function TripExtensionsSection({
    extensions,
    voice,
    onChanged,
}: {
    extensions: ExtensionRow[]
    voice: 'guest' | 'host'
    onChanged: () => void
}) {
    const [working, setWorking] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    // The guest doesn't need their abandoned attempts listed back to them.
    const visible = voice === 'host'
        ? extensions
        : extensions.filter(e => e.status === 'confirmed' || e.status === 'requested' || e.status === 'declined')
    if (visible.length === 0) return null

    const decide = async (id: string, approve: boolean) => {
        setWorking(id)
        setError(null)
        try {
            await decideTripExtension({ data: { extensionId: id, approve } })
            onChanged()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'That didn’t work.')
        } finally {
            setWorking(null)
        }
    }

    return (
        <TripSection title="Extensions">
            <ul className="divide-y divide-line border border-line rounded-xl">
                {visible.map(extension => (
                    <li key={extension.id} className="p-3 sm:p-4 flex items-start justify-between gap-4">
                        <div className="min-w-0 text-sm">
                            <p className="font-semibold text-ink">
                                To {formatBusinessDateTime(extension.to_end_time)}
                            </p>
                            <p className="text-muted">
                                From {formatBusinessDateTime(extension.from_end_time)} · {STATUS_TEXT[extension.status]}
                                {extension.mode === 'request' && ' · last-hour request'}
                            </p>
                        </div>
                        <div className="text-right shrink-0 space-y-1">
                            <Money amount={extension.amount} className="block text-sm font-bold text-ink" />
                            {voice === 'host' && extension.status === 'requested' && (
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        disabled={working !== null}
                                        onClick={() => decide(extension.id, true)}
                                        className="text-sm font-semibold text-pine-500 hover:underline cursor-pointer disabled:opacity-50"
                                    >
                                        Approve
                                    </button>
                                    <button
                                        type="button"
                                        disabled={working !== null}
                                        onClick={() => decide(extension.id, false)}
                                        className="text-sm font-semibold text-red-700 hover:underline cursor-pointer disabled:opacity-50"
                                    >
                                        Decline
                                    </button>
                                </div>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
            <DialogError message={error} />
        </TripSection>
    )
}