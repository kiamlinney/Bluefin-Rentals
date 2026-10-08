import { useState } from 'react'
import {
    captureTripDeposit,
    placeTripDeposit,
    releaseTripDeposit,
    setDepositKeepHolding,
    setDepositWaived,
} from '@/lib/payments'
import type { ChargeRow } from '@/lib/charges'
import { chargeStatusLabel } from '@/lib/charges'
import {
    DEPOSIT_PLACE_BEFORE_HOURS,
    DEPOSIT_RELEASE_AFTER_HOURS,
    DEPOSIT_RETRY_AFTER_HOURS,
    depositPlaceAt,
    depositReleaseAt,
    formatDepositAmount,
    type DepositState,
} from '@/lib/deposit'
import { formatBusinessDateTime } from '@/lib/dates'
import { TripSection } from './TripSection'
import { CardUpdateDialog } from './CardUpdateDialog'
import {
    DialogError,
    ModalShell,
    Money,
    dialogInputClass,
    primaryButtonClass,
    secondaryButtonClass,
} from './ModalShell'

// The security deposit on both reservation pages (ImportantFiles/deposit.md).
//
// The guest sees where their hold stands and can replace their card — the fix
// for a declined hold, which is also what's keeping their lockbox code from
// them. An owner additionally captures, releases, keeps holding or waives.

export type TripDeposit = {
    state: DepositState
    charge: ChargeRow | null
    history: ChargeRow[]
    waivedAt: string | null
}

const linkButton = 'text-sm font-semibold text-pine-500 hover:underline cursor-pointer disabled:opacity-50'

export function TripDepositSection({
    bookingId,
    deposit,
    card,
    voice,
    tripStart,
    tripEnd,
    active,
    onChanged,
}: {
    bookingId: string
    deposit: TripDeposit
    card: { brand: string; last4: string } | null
    voice: 'guest' | 'host'
    tripStart: string
    tripEnd: string
    /** False for a canceled or unpaid trip: nothing to hold. */
    active: boolean
    onChanged: () => void
}) {
    const [updatingCard, setUpdatingCard] = useState(false)
    const [capturing, setCapturing] = useState(false)
    const [working, setWorking] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const hold = deposit.charge
    const amount = formatDepositAmount(hold?.amount)
    const isHost = voice === 'host'
    const whose = isHost ? "the guest's" : 'your'
    const cardText = card
        ? card.brand === 'link'
            ? `${whose} Link wallet`
            : `${whose} ${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)} card ending ${card.last4}`
        : `${whose} card on file`
    const releaseAt = formatBusinessDateTime(depositReleaseAt(new Date(tripEnd)))

    const run = async (fn: () => Promise<unknown>, done?: string) => {
        setWorking(true)
        setError(null)
        try {
            await fn()
            if (done) setNotice(done)
            onChanged()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'That didn’t work.')
        } finally {
            setWorking(false)
        }
    }

    if (!active && !hold) return null

    return (
        <TripSection
            title="Security deposit"
            action={
                !isHost && active && deposit.state !== 'done' ? (
                    <button type="button" className={linkButton} onClick={() => setUpdatingCard(true)}>
                        Update card
                    </button>
                ) : undefined
            }
        >
            {deposit.state === 'waived' && (
                <p className="text-sm text-muted max-w-md">
                    {isHost ? `Waived ${deposit.waivedAt ? formatBusinessDateTime(deposit.waivedAt) : ''}. No hold is placed on this trip.` : 'No security hold is needed for this trip.'}
                </p>
            )}

            {deposit.state === 'not-yet' && (
                <p className="text-sm text-muted max-w-md">
                    A {amount} refundable hold will be placed on {cardText} about {DEPOSIT_PLACE_BEFORE_HOURS} hours
                    before pickup ({formatBusinessDateTime(depositPlaceAt(new Date(tripStart)))}).
                    It isn't a charge, and it's released {DEPOSIT_RELEASE_AFTER_HOURS} hours after {isHost ? 'the guest returns' : 'you return'} the car.
                    {!isHost && ' Your lockbox code is sent once the hold is placed.'}
                </p>
            )}

            {deposit.state === 'held' && hold && hold.status === 'authorized' && (
                <p className="text-sm text-muted max-w-md">
                    <span className="text-ink font-semibold">{amount} held</span> on {cardText}. It will be released
                    around {releaseAt}{isHost && hold.keep_holding ? ' — except you chose to keep holding it' : ''}.
                    {isHost && hold.capture_before && <> Stripe's deadline to capture: {formatBusinessDateTime(hold.capture_before)}.</>}
                </p>
            )}

            {hold && hold.status === 'succeeded' && (
                <p className="text-sm text-muted max-w-md">
                    <Money amount={hold.amount_captured} className="text-ink font-semibold" /> of the {amount} hold was
                    kept{hold.line_items[0] ? `: ${hold.line_items[0].label}` : ''}. The rest was released.
                </p>
            )}

            {deposit.state === 'missing' && (
                <div className="bg-amber-100 border border-amber-700 rounded-xl p-3 text-sm text-ink max-w-md">
                    {isHost ? (
                        <>No hold is in place{hold?.failure_message ? ` — last attempt: "${hold.failure_message}"` : ''}. The lockbox code is withheld from the guest. The system retries every {DEPOSIT_RETRY_AFTER_HOURS} hours; the guest has been asked to update their card.</>
                    ) : (
                        <>We couldn't place your {formatDepositAmount()} security hold{hold?.failure_message ? ` ("${hold.failure_message}")` : ''}. Your lockbox code is sent as soon as a hold goes through. Add or update your card to try again now.</>
                    )}
                </div>
            )}

            {deposit.state === 'done' && hold?.status === 'canceled' && (
                <p className="text-sm text-muted">The hold was released. Nothing was charged.</p>
            )}

            {notice && <p className="text-sm text-pine-700">{notice}</p>}
            <DialogError message={error} />

            {isHost && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                    {hold?.status === 'authorized' && (
                        <>
                            <button type="button" className={linkButton} disabled={working} onClick={() => setCapturing(true)}>
                                Capture for damage…
                            </button>
                            <button
                                type="button"
                                className={linkButton}
                                disabled={working}
                                onClick={() => run(() => releaseTripDeposit({ data: hold.id }), 'Hold released.')}
                            >
                                Release now
                            </button>
                            <button
                                type="button"
                                className={linkButton}
                                disabled={working}
                                onClick={() => run(() => setDepositKeepHolding({ data: { chargeId: hold.id, keep: !hold.keep_holding } }))}
                            >
                                {hold.keep_holding ? 'Allow automatic release' : 'Keep holding'}
                            </button>
                        </>
                    )}
                    {deposit.state === 'missing' && (
                        <button
                            type="button"
                            className={linkButton}
                            disabled={working}
                            onClick={() => run(async () => {
                                const attempt = await placeTripDeposit({ data: bookingId })
                                if (attempt.state === 'declined') throw new Error(`Declined${attempt.message ? `: ${attempt.message}` : ''}`)
                                if (attempt.state === 'no-card') throw new Error('There is no saved card on this trip.')
                            }, 'Hold placed.')}
                        >
                            Try the hold now
                        </button>
                    )}
                    {active && deposit.state !== 'held' && (
                        <button
                            type="button"
                            className={linkButton}
                            disabled={working}
                            onClick={() => run(() => setDepositWaived({ data: { bookingId, waived: deposit.state !== 'waived' } }))}
                        >
                            {deposit.state === 'waived' ? 'Require a deposit again' : 'Waive deposit'}
                        </button>
                    )}
                </div>
            )}

            {isHost && deposit.history.length > 1 && (
                <details className="text-xs text-muted pt-1">
                    <summary className="cursor-pointer">Hold history ({deposit.history.length})</summary>
                    <ul className="mt-1 space-y-0.5">
                        {deposit.history.map(h => (
                            <li key={h.id}>
                                {formatBusinessDateTime(h.created_at)} · {chargeStatusLabel(h)}
                                {h.failure_message ? ` · ${h.failure_message}` : ''}
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            {updatingCard && (
                <CardUpdateDialog
                    bookingId={bookingId}
                    onClose={() => setUpdatingCard(false)}
                    onDone={(message) => {
                        setUpdatingCard(false)
                        setNotice(message)
                        onChanged()
                    }}
                />
            )}

            {capturing && hold && (
                <CaptureDepositDialog
                    hold={hold}
                    onClose={() => setCapturing(false)}
                    onDone={() => { setCapturing(false); onChanged() }}
                />
            )}
        </TripSection>
    )
}

function CaptureDepositDialog({ hold, onClose, onDone }: { hold: ChargeRow; onClose: () => void; onDone: () => void }) {
    const [amount, setAmount] = useState('')
    const [reason, setReason] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const value = Number(amount)
    const valid = value > 0 && value <= hold.amount && reason.trim().length > 0

    const submit = async () => {
        setWorking(true)
        setError(null)
        try {
            await captureTripDeposit({ data: { chargeId: hold.id, amount: value, reason } })
            onDone()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'The capture failed.')
            setWorking(false)
        }
    }

    return (
        <ModalShell
            title="Capture from the deposit"
            busy={working}
            onClose={onClose}
            footer={
                <>
                    <button type="button" className={secondaryButtonClass} disabled={working} onClick={onClose}>Cancel</button>
                    <button type="button" className={primaryButtonClass} disabled={!valid || working} onClick={submit}>
                        {working ? 'Capturing…' : `Capture $${Number.isFinite(value) ? value.toFixed(2) : '0.00'}`}
                    </button>
                </>
            }
        >
            <p className="text-sm text-muted">
                Up to <Money amount={hold.amount} /> can be kept. Whatever you don't capture is released in the same
                step, and <strong>a hold can only be captured once</strong>. If the damage costs more than the hold,
                capture all of it and charge the rest separately under Additional charges.
            </p>
            <label className="block">
                <span className="block text-sm font-semibold text-ink mb-1.5">Amount</span>
                <input className={dialogInputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </label>
            <label className="block">
                <span className="block text-sm font-semibold text-ink mb-1.5">What it's for (the guest is told)</span>
                <textarea className={dialogInputClass} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <DialogError message={error} />
        </ModalShell>
    )
}