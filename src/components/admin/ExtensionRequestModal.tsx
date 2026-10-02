import { useEffect, useState } from 'react'
import { decideTripExtension } from '@/lib/payments'
// Type-only, so it's erased from the browser bundle.
import type { ExtensionRow } from '@/lib/payments.server'
import { formatBusinessDateTime, getRelativeTimeString } from '@/lib/dates'
import {
    DialogError,
    ModalShell,
    Money,
    primaryButtonClass,
} from '@/components/trip/ModalShell'

// A last-hour extension request, put in front of the owner the first time they
// open the reservation after it arrives. These are time-sensitive — the trip is
// about to end — and the Extensions section further down the page was too easy
// to scroll past. The request stays there too; this is only the prompt.
//
// "Seen" is remembered in this browser (localStorage), so each owner on each
// device gets the pop-up once per request. No database column: one owner
// dismissing it shouldn't hide it from the other. Storage can be unavailable
// (private windows, blocked site data), in which case the pop-up simply shows
// again next time — the safe way to fail.

const seenKey = (extensionId: string) => `bluefin.extensionRequestSeen.${extensionId}`

function markSeen(extensionId: string) {
    try {
        window.localStorage.setItem(seenKey(extensionId), new Date().toISOString())
    } catch {
        // storage unavailable: it just shows again next visit
    }
}

function wasSeen(extensionId: string): boolean {
    try {
        return window.localStorage.getItem(seenKey(extensionId)) !== null
    } catch {
        return false
    }
}

export function ExtensionRequestModal({
    extension,
    guestName,
    onDecided,
}: {
    /** The trip's open `requested` extension, if any. */
    extension: ExtensionRow | null
    guestName: string
    onDecided: () => void
}) {
    const [open, setOpen] = useState(false)
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // After mount, not during render: localStorage doesn't exist on the server,
    // and reading it in render would make the server and browser disagree.
    useEffect(() => {
        if (!extension || extension.status !== 'requested') return
        if (wasSeen(extension.id)) return
        markSeen(extension.id)
        setOpen(true)
    }, [extension?.id, extension?.status])

    if (!open || !extension) return null

    const decide = async (approve: boolean) => {
        setWorking(true)
        setError(null)
        try {
            await decideTripExtension({ data: { extensionId: extension.id, approve } })
            setOpen(false)
            onDecided()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'That didn’t work.')
            setWorking(false)
        }
    }

    const relative = getRelativeTimeString(new Date(extension.from_end_time), new Date())
    const endsIn = relative === 'now' ? 'already ended' : `in ${relative}`

    return (
        <ModalShell
            title="Extension request"
            busy={working}
            onClose={() => setOpen(false)}
            footer={
                <>
                    {/* A quiet link on the left, so the two real answers sit
                        together on the right at full width. */}
                    <button
                        type="button"
                        disabled={working}
                        onClick={() => setOpen(false)}
                        className="mr-auto text-sm font-semibold text-muted hover:text-ink whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                        Decide later
                    </button>
                    <button
                        type="button"
                        disabled={working}
                        onClick={() => decide(false)}
                        className="px-4 py-2.5 rounded-xl border border-red-700 text-red-700 text-sm font-bold whitespace-nowrap hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        Decline
                    </button>
                    <button type="button" className={primaryButtonClass} disabled={working} onClick={() => decide(true)}>
                        {working ? 'Working…' : <>Approve · <Money amount={extension.amount} /></>}
                    </button>
                </>
            }
        >
            <p className="text-sm text-ink">
                <strong>{guestName}</strong> asked to extend their trip in its last hour, so it needs your
                answer.
            </p>
            <dl className="text-sm space-y-1.5">
                <div className="flex justify-between gap-4">
                    <dt className="text-muted">Trip currently ends</dt>
                    <dd className="text-ink text-right">
                        {formatBusinessDateTime(extension.from_end_time)}
                        <span className="block text-xs text-muted">{endsIn}</span>
                    </dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt className="text-muted">Would end</dt>
                    <dd className="text-ink font-semibold text-right">{formatBusinessDateTime(extension.to_end_time)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt className="text-muted">Held on their card</dt>
                    <dd className="text-ink font-semibold"><Money amount={extension.amount} /></dd>
                </div>
            </dl>
            <p className="text-xs text-muted">
                Approve charges the hold and moves the trip's end. Decline releases the hold. Either way the
                guest is emailed. You can also answer later from the Extensions section.
            </p>
            <DialogError message={error} />
        </ModalShell>
    )
}
