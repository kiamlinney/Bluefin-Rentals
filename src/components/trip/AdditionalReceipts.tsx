import { chargeKindLabel, chargeTotal, type ChargeRow } from '@/lib/charges'
import { formatBusinessDateTime } from '@/lib/dates'
import { displayTaxLines } from '@/lib/tax'
import { Money } from './ModalShell'
import { RefundBadge } from './TripChargesSection'

// Receipts for everything charged after checkout, printed below the checkout
// receipt on /trips/{id}/receipt.
//
// One block per charge, each a record of its own transaction: when, what for,
// its lines and tax, and anything refunded since. The checkout receipt above is
// never rewritten to include these — a receipt records a transaction, and a
// disputed charge turns on being able to say exactly what was charged when.
// (ImportantFiles/charges-and-invoicing.md)
//
// Only money that actually moved: a succeeded charge, or the part of a deposit
// hold that was kept. Holds that were released, requests that were declined and
// attempts that failed aren't transactions and don't appear.

export function AdditionalReceipts({ charges, checkoutNet }: { charges: ChargeRow[]; checkoutNet: number }) {
    const paid = charges.filter(c => c.status === 'succeeded' && c.amount_captured > 0)
    if (paid.length === 0) return null

    const net = (c: ChargeRow) => Math.round((c.amount_captured - c.amount_refunded) * 100) / 100
    const grandTotal = Math.round((checkoutNet + paid.reduce((sum, c) => sum + net(c), 0)) * 100) / 100

    return (
        <section className="mt-8 space-y-4 break-inside-avoid">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Charged after booking
            </h2>

            {paid.map(charge => {
                // A captured deposit bills what was kept, not the size of the hold.
                const isDeposit = charge.kind === 'deposit'
                const lines = isDeposit
                    ? [{ label: charge.line_items[0]?.label ?? 'Kept from security deposit', amount: charge.amount_captured }]
                    : charge.line_items
                return (
                    <div key={charge.id} className="border border-line rounded-xl p-4 sm:p-5 space-y-2 break-inside-avoid">
                        <div className="flex items-baseline justify-between gap-4">
                            <p className="text-sm font-bold uppercase tracking-wide text-ink">
                                {isDeposit ? 'Security deposit (kept)' : chargeKindLabel(charge)}
                            </p>
                            <p className="text-xs text-muted">{formatBusinessDateTime(charge.settled_at ?? charge.created_at)}</p>
                        </div>
                        <RefundBadge charge={charge} />
                        {!isDeposit && <p className="text-sm text-muted">{charge.description}</p>}
                        <div className="space-y-1 text-sm">
                            {lines.map((item, i) => (
                                <div key={i} className="flex justify-between gap-4">
                                    <span className="text-ink">{item.label}{'detail' in item && item.detail ? ` (${item.detail})` : ''}</span>
                                    <Money amount={item.amount} className="text-ink" />
                                </div>
                            ))}
                            {!isDeposit && displayTaxLines(charge.tax_lines).map(tax => (
                                <div key={tax.id} className="flex justify-between gap-4">
                                    <span className="text-muted">{tax.label}</span>
                                    <Money amount={tax.amount} className="text-muted" />
                                </div>
                            ))}
                            <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-bold text-ink">
                                <span>Charged</span>
                                <Money amount={isDeposit ? charge.amount_captured : chargeTotal(charge)} />
                            </div>
                            {charge.amount_refunded > 0 && (
                                <>
                                    <div className="flex justify-between gap-4 font-bold text-pine-700">
                                        <span>Refunded</span>
                                        <Money amount={-charge.amount_refunded} />
                                    </div>
                                    <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-bold text-ink">
                                        <span>Net paid</span>
                                        <Money amount={net(charge)} />
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )
            })}

            <div className="flex justify-between gap-4 border-t-2 border-ink pt-3 text-base font-bold text-ink">
                <span>Total paid for this trip</span>
                <Money amount={grandTotal} />
            </div>
        </section>
    )
}