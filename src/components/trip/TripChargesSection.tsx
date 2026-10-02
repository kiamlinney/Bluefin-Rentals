import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { createTripCharge, refundTripCharge } from '@/lib/payments'
import { calculateTax, displayTaxLines, type TaxContext } from '@/lib/tax'
import {
    CHARGE_CATEGORIES,
    chargeCategoryLabel,
    chargeKindLabel,
    chargeStatusLabel,
    chargeTotal,
    needsGuestPayment,
    type ChargeRow,
} from '@/lib/charges'
import { formatBusinessDateTime } from '@/lib/dates'
import { TripSection } from './TripSection'
import {
    DialogError,
    ModalShell,
    Money,
    dialogInputClass,
    primaryButtonClass,
    secondaryButtonClass,
} from './ModalShell'

// Every charge after checkout — extensions, extras, owners' charges — on the
// guest trip page and the admin reservation page alike. The deposit has its own
// section (TripDepositSection); a hold isn't a charge until some of it is kept.
//
// Shared, with `voice` deciding the copy and what each side may do: the guest
// can pay anything their saved card couldn't; an owner can bill the card and
// refund. Policy: ImportantFiles/charges-and-invoicing.md.

export function TripChargesSection({
    bookingId,
    charges,
    voice,
    canCharge = false,
    hasCard = false,
    suggestedMileage = null,
    taxContext,
    onChanged,
}: {
    bookingId: string
    charges: ChargeRow[]
    voice: 'guest' | 'host'
    /** Host only: whether "Charge guest" is offered at all. */
    canCharge?: boolean
    hasCard?: boolean
    /** Host only: pre-fill for a mileage overage, from calculateOverage. */
    suggestedMileage?: { amount: number; description: string } | null
    /** Host only: how this trip is taxed, so the form shows the tax it will add. */
    taxContext?: TaxContext
    onChanged: () => void
}) {
    const [newCharge, setNewCharge] = useState(false)
    const [refunding, setRefunding] = useState<ChargeRow | null>(null)

    // A guest doesn't need to see a request an owner declined, or an extension
    // attempt that never went through. An owner does — it's the record.
    const visible = voice === 'host'
        ? charges
        : charges.filter(c => c.status !== 'failed' && c.status !== 'canceled')

    if (voice === 'guest' && visible.length === 0) return null

    return (
        <TripSection
            title="Additional charges"
            action={
                voice === 'host' && canCharge ? (
                    <button
                        type="button"
                        onClick={() => setNewCharge(true)}
                        className="text-sm font-semibold text-pine-500 hover:underline cursor-pointer"
                    >
                        Charge guest
                    </button>
                ) : undefined
            }
        >
            {visible.length === 0 ? (
                <p className="text-sm text-muted">Nothing charged since checkout.</p>
            ) : (
                <ul className="divide-y divide-line border border-line rounded-xl">
                    {visible.map(charge => {
                        const refundable = Math.round((charge.amount_captured - charge.amount_refunded) * 100) / 100
                        return (
                            <li key={charge.id} className="p-3 sm:p-4 flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-ink">{chargeKindLabel(charge)}</p>
                                    <p className="text-sm text-muted">{charge.description}</p>
                                    <p className="text-xs text-muted mt-0.5">
                                        {formatBusinessDateTime(charge.created_at)}
                                        {/* The refund has its own badge on the right. */}
                                        {charge.amount_refunded <= 0 && <> · {chargeStatusLabel(charge)}</>}
                                    </p>
                                    {voice === 'host' && charge.failure_message && charge.status !== 'succeeded' && (
                                        <p className="text-xs text-red-700 mt-0.5">{charge.failure_message}</p>
                                    )}
                                </div>
                                <div className="text-right shrink-0 space-y-1">
                                    <Money
                                        amount={chargeTotal(charge)}
                                        className={`block text-sm font-bold ${
                                            charge.amount_refunded > 0 && refundable <= 0 ? 'text-muted line-through' : 'text-ink'
                                        }`}
                                    />
                                    <RefundBadge charge={charge} />
                                    {voice === 'guest' && needsGuestPayment(charge) && (
                                        <Link
                                            to="/trips/$bookingId/pay/$chargeId"
                                            params={{ bookingId, chargeId: charge.id }}
                                            className="block text-sm font-semibold text-pine-500 hover:underline"
                                        >
                                            Pay now
                                        </Link>
                                    )}
                                    {voice === 'host' && charge.status === 'succeeded' && refundable > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setRefunding(charge)}
                                            className="block text-sm font-semibold text-pine-500 hover:underline cursor-pointer"
                                        >
                                            Refund
                                        </button>
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}

            {newCharge && (
                <NewChargeDialog
                    bookingId={bookingId}
                    hasCard={hasCard}
                    suggestedMileage={suggestedMileage}
                    taxContext={taxContext}
                    onClose={() => setNewCharge(false)}
                    onDone={() => { setNewCharge(false); onChanged() }}
                />
            )}
            {refunding && (
                <RefundChargeDialog
                    charge={refunding}
                    onClose={() => setRefunding(null)}
                    onDone={() => { setRefunding(null); onChanged() }}
                />
            )}
        </TripSection>
    )
}

/**
 * A refund, made hard to miss: a green pill under the amount on both reservation
 * pages. Fully refunded charges also get their amount struck through.
 */
export function RefundBadge({ charge }: { charge: Pick<ChargeRow, 'amount_captured' | 'amount_refunded'> }) {
    if (charge.amount_refunded <= 0) return null
    const full = charge.amount_refunded >= charge.amount_captured - 0.005
    return (
        <span className="inline-block rounded-full bg-pine-500/15 px-2.5 py-0.5 text-xs font-bold text-pine-700">
            {full ? 'Refunded' : 'Partly refunded'} <Money amount={-charge.amount_refunded} />
        </span>
    )
}

function NewChargeDialog({
    bookingId,
    hasCard,
    suggestedMileage,
    taxContext,
    onClose,
    onDone,
}: {
    bookingId: string
    hasCard: boolean
    suggestedMileage: { amount: number; description: string } | null
    taxContext?: TaxContext
    onClose: () => void
    onDone: () => void
}) {
    const [category, setCategory] = useState<string>('')
    const [description, setDescription] = useState('')
    const [amount, setAmount] = useState('')
    const [confirming, setConfirming] = useState(false)
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<string | null>(null)

    const pickCategory = (id: string) => {
        setCategory(id)
        if (id === 'mileage' && suggestedMileage) {
            setDescription(suggestedMileage.description)
            setAmount(suggestedMileage.amount.toFixed(2))
        }
    }

    const value = Number(amount)
    const valid = Boolean(category) && description.trim().length > 0 && Number.isFinite(value) && value > 0

    // The same calculation createAdjustmentCharge makes on the server, so the
    // figure confirmed here is the figure charged.
    const taxKey = CHARGE_CATEGORIES.find(c => c.id === category)?.taxKey ?? 'other'
    const tax = valid && taxContext ? calculateTax([{ taxKey, amount: value }], taxContext) : { lines: [], total: 0 }
    const chargeTotalWithTax = Math.round((value + tax.total) * 100) / 100

    const submit = async () => {
        setWorking(true)
        setError(null)
        try {
            const { charge, error: chargeError } = await createTripCharge({
                data: { bookingId, category, description, amount: value },
            })
            if (charge.status === 'succeeded') setResult(`Charged $${chargeTotal(charge).toFixed(2)} to the guest's card.`)
            else if (charge.status === 'requires_payment') setResult(`The card couldn't be charged${chargeError ? ` (${chargeError})` : ''}. The guest has been emailed a link to pay it.`)
            else setResult(`The charge is ${chargeStatusLabel(charge).toLowerCase()}.`)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'The charge failed.')
        } finally {
            setWorking(false)
        }
    }

    if (result) {
        return (
            <ModalShell title="Charge guest" onClose={onDone} footer={<button className={primaryButtonClass} onClick={onDone}>Done</button>}>
                <p className="text-sm text-ink">{result}</p>
            </ModalShell>
        )
    }

    return (
        <ModalShell
            title="Charge guest"
            busy={working}
            onClose={onClose}
            footer={confirming ? (
                <>
                    <button type="button" className={secondaryButtonClass} disabled={working} onClick={() => setConfirming(false)}>Back</button>
                    <button type="button" className={primaryButtonClass} disabled={working} onClick={submit}>
                        {working ? 'Charging…' : `Charge $${chargeTotalWithTax.toFixed(2)}`}
                    </button>
                </>
            ) : (
                <>
                    <button type="button" className={secondaryButtonClass} onClick={onClose}>Cancel</button>
                    <button type="button" className={primaryButtonClass} disabled={!valid || !hasCard} onClick={() => setConfirming(true)}>
                        Review
                    </button>
                </>
            )}
        >
            {!hasCard && (
                <DialogError message="There's no card saved on this trip, so nothing can be charged. This happens for trips booked before cards were saved." />
            )}
            {confirming ? (
                <div className="space-y-2 text-sm">
                    <p className="text-ink">
                        The guest's saved card will be charged <strong>${chargeTotalWithTax.toFixed(2)}</strong> for:
                    </p>
                    <p className="text-ink bg-subtle rounded-lg p-3">{description}</p>
                    <div className="space-y-1">
                        <div className="flex justify-between"><span className="text-muted">Amount</span><Money amount={value} /></div>
                        {displayTaxLines(tax.lines).map(line => (
                            <div key={line.id} className="flex justify-between">
                                <span className="text-muted">{line.label}</span><Money amount={line.amount} />
                            </div>
                        ))}
                        {tax.lines.length === 0 && (
                            <p className="text-xs text-muted">No tax: {chargeCategoryLabel(category)?.toLowerCase() ?? 'this'} charges aren't taxed (src/lib/tax.ts).</p>
                        )}
                    </div>
                    <p className="text-muted">
                        They'll get an emailed receipt. If their bank declines or wants them to confirm, they're
                        emailed a link to pay it themselves.
                    </p>
                </div>
            ) : (
                <>
                    <label className="block">
                        <span className="block text-sm font-semibold text-ink mb-1.5">What for</span>
                        <select className={dialogInputClass} value={category} onChange={(e) => pickCategory(e.target.value)}>
                            <option value="">Choose…</option>
                            {CHARGE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                    </label>
                    <label className="block">
                        <span className="block text-sm font-semibold text-ink mb-1.5">Description (the guest sees this)</span>
                        <textarea
                            className={dialogInputClass}
                            rows={3}
                            maxLength={500}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </label>
                    <label className="block">
                        <span className="block text-sm font-semibold text-ink mb-1.5">Amount (before tax)</span>
                        <input
                            className={dialogInputClass}
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                        />
                    </label>
                </>
            )}
            <DialogError message={error} />
        </ModalShell>
    )
}

function RefundChargeDialog({
    charge,
    onClose,
    onDone,
}: {
    charge: ChargeRow
    onClose: () => void
    onDone: () => void
}) {
    const refundable = Math.round((charge.amount_captured - charge.amount_refunded) * 100) / 100
    const [amount, setAmount] = useState(refundable.toFixed(2))
    const [reason, setReason] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const value = Number(amount)

    const submit = async () => {
        setWorking(true)
        setError(null)
        try {
            await refundTripCharge({ data: { chargeId: charge.id, amount: value, reason } })
            onDone()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'The refund failed.')
            setWorking(false)
        }
    }

    return (
        <ModalShell
            title="Refund charge"
            busy={working}
            onClose={onClose}
            footer={
                <>
                    <button type="button" className={secondaryButtonClass} disabled={working} onClick={onClose}>Cancel</button>
                    <button
                        type="button"
                        className={primaryButtonClass}
                        disabled={working || !(value > 0 && value <= refundable)}
                        onClick={submit}
                    >
                        {working ? 'Refunding…' : `Refund $${Number.isFinite(value) ? value.toFixed(2) : '0.00'}`}
                    </button>
                </>
            }
        >
            <p className="text-sm text-muted">
                {charge.description} · up to <Money amount={refundable} /> can be refunded. It goes back to the
                card that paid it and usually lands in 5–10 business days.
            </p>
            <label className="block">
                <span className="block text-sm font-semibold text-ink mb-1.5">Amount</span>
                <input className={dialogInputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="block">
                <span className="block text-sm font-semibold text-ink mb-1.5">Reason (for your records)</span>
                <input className={dialogInputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </label>
            <DialogError message={error} />
        </ModalShell>
    )
}