import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { blockCustomer, unblockCustomer } from '@/lib/crm'
import { MAX_BLOCK_REASON } from '@/lib/blocks'
import { formatBusinessDateTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import {
    DialogError,
    ModalShell,
    dialogInputClass,
    primaryButtonClass,
    secondaryButtonClass,
} from '@/components/trip/ModalShell'

// Blocking and unblocking a customer, from their CRM page.
//
// What a block does is spelled out in the dialog because it is deliberately
// narrower than "ban": they can still sign in and pay what they owe, and their
// confirmed trips are left alone. After the block, the dialog lists those
// trips so the owner can decide about each on its reservation page, where
// cancelling refunds in full as a business cancellation.

const dangerButtonClass =
    'px-4 py-2.5 rounded-xl bg-red-700 text-white text-sm font-bold whitespace-nowrap hover:bg-red-800 transition-colors ' +
    'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'

type Result = Awaited<ReturnType<typeof blockCustomer>>

export function BlockCustomerModal({
    userId,
    name,
    hasLicense,
    onClose,
    onDone,
}: {
    userId: string
    name: string
    /** Whether we hold their licence number. Without it, the owner can type it in. */
    hasLicense: boolean
    onClose: () => void
    onDone: () => Promise<void> | void
}) {
    const [reason, setReason] = useState('')
    const [license, setLicense] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<Result | null>(null)

    const submit = async () => {
        setWorking(true)
        setError(null)
        try {
            const r = await blockCustomer({ data: { userId, reason, licenseNumber: license.trim() || undefined } })
            setResult(r)
            await onDone()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not block this customer.')
        } finally {
            setWorking(false)
        }
    }

    if (result) {
        return (
            <ModalShell
                title={`${name} is blocked`}
                onClose={onClose}
                footer={<button type="button" className={primaryButtonClass} onClick={onClose}>Done</button>}
            >
                <p className="text-sm text-ink">
                    They can no longer book, verify an ID, extend a trip, request extras or leave a review.
                    {result.releasedCheckouts > 0 && ` ${result.releasedCheckouts} unpaid checkout${result.releasedCheckouts === 1 ? ' was' : 's were'} closed so they can't be paid.`}
                </p>
                {result.upcomingTrips.length > 0 ? (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
                        <p className="text-sm font-bold text-ink">
                            {result.upcomingTrips.length === 1 ? 'They still have a confirmed trip' : `They still have ${result.upcomingTrips.length} confirmed trips`}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                            A block doesn't cancel trips. To call one off, cancel it from its reservation page. It is refunded in full,
                            as any trip we cancel is.
                        </p>
                        <ul className="mt-2 space-y-1 text-sm">
                            {result.upcomingTrips.map(t => (
                                <li key={t.id}>
                                    <Link to="/admin/reservation/$bookingId" params={{ bookingId: t.id }} className="font-semibold underline">
                                        {formatBusinessDateTime(t.start_time)} to {formatBusinessDateTime(t.end_time)}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <p className="text-sm text-muted">They have no upcoming trips.</p>
                )}
            </ModalShell>
        )
    }

    return (
        <ModalShell
            title={`Block ${name}?`}
            busy={working}
            onClose={onClose}
            footer={
                <>
                    <button type="button" className={secondaryButtonClass} disabled={working} onClick={onClose}>Cancel</button>
                    <button type="button" className={dangerButtonClass} disabled={working || !reason.trim()} onClick={submit}>
                        {working ? 'Blocking…' : 'Block customer'}
                    </button>
                </>
            }
        >
            <ul className="space-y-1.5 text-sm text-ink list-disc pl-5 marker:text-muted">
                <li>They can't book, verify an ID, extend a trip, request extras or leave a review.</li>
                <li>They can still sign in to see their trips and receipts, and pay anything they owe.</li>
                <li>Any checkout they haven't paid for is closed.</li>
                <li>Confirmed trips are <strong>not</strong> cancelled. You'll see them next.</li>
                <li>
                    {hasLicense
                        ? "Their driver's licence is blocked too, so a new account with it is blocked when it verifies, and you're emailed."
                        : "We don't have their licence number, so only this account is blocked. Add it below to block the licence too."}
                </li>
                <li>Nobody is emailed. They see a neutral message asking them to contact us.</li>
            </ul>

            <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-ink">Reason <span className="font-normal text-muted">(only owners see it)</span></span>
                <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={MAX_BLOCK_REASON}
                    rows={3}
                    disabled={working}
                    placeholder="e.g. Returned the car with smoke damage and disputed the charge."
                    className={cn(dialogInputClass, 'resize-none')}
                />
            </label>

            {!hasLicense && (
                <label className="block space-y-1.5">
                    <span className="text-sm font-semibold text-ink">
                        Licence number <span className="font-normal text-muted">(optional, from the Stripe Dashboard)</span>
                    </span>
                    <input
                        value={license}
                        onChange={e => setLicense(e.target.value)}
                        disabled={working}
                        autoComplete="off"
                        className={dialogInputClass}
                    />
                </label>
            )}

            <DialogError message={error} />
        </ModalShell>
    )
}

export function UnblockCustomerModal({
    userId,
    name,
    otherAccounts,
    onClose,
    onDone,
}: {
    userId: string
    name: string
    /** Other accounts the same licence block covers, which are unblocked too. */
    otherAccounts: { id: string; name: string | null }[]
    onClose: () => void
    onDone: () => Promise<void> | void
}) {
    const [reason, setReason] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const submit = async () => {
        setWorking(true)
        setError(null)
        try {
            await unblockCustomer({ data: { userId, reason } })
            await onDone()
            onClose()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not unblock this customer.')
            setWorking(false)
        }
    }

    return (
        <ModalShell
            title={`Unblock ${name}?`}
            busy={working}
            onClose={onClose}
            footer={
                <>
                    <button type="button" className={secondaryButtonClass} disabled={working} onClick={onClose}>Cancel</button>
                    <button type="button" className={primaryButtonClass} disabled={working || !reason.trim()} onClick={submit}>
                        {working ? 'Unblocking…' : 'Unblock'}
                    </button>
                </>
            }
        >
            <p className="text-sm text-ink">
                They'll be able to book again straight away. The block stays in their history.
            </p>
            {otherAccounts.length > 0 && (
                <p className="text-sm text-ink">
                    The block is on their driver's licence, so this also unblocks{' '}
                    {otherAccounts.map((a, i) => (
                        <span key={a.id}>{i > 0 && ', '}<strong>{a.name || 'another account'}</strong></span>
                    ))}
                    , and any other account with the same licence.
                </p>
            )}
            <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-ink">Reason <span className="font-normal text-muted">(only owners see it)</span></span>
                <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={MAX_BLOCK_REASON}
                    rows={2}
                    disabled={working}
                    className={cn(dialogInputClass, 'resize-none')}
                />
            </label>
            <DialogError message={error} />
        </ModalShell>
    )
}
