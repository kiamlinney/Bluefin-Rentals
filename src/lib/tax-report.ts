// The tax report: what tax was collected, and refunded, month by month — the
// figures a Minnesota sales tax return is filed from.
//
// Pure: it takes the rows the server reads (checkout quotes and ledger charges)
// and adds them up, so the arithmetic can't differ between the page and its CSV.
//
// ▶ Two conventions here are placeholders until an accountant confirms them
// (ImportantFiles/tax-todo.md, item 7):
//   - a sale is reported in the month it was paid — a checkout in the month the
//     booking was made, a later charge in the month it settled;
//   - a refund returns tax in proportion to the share of the payment refunded,
//     reported in the same month as the sale (not the month of the refund).

import type { TaxLine } from './tax.ts'
import { roundMoney } from './money.ts'

export type TaxedSale = {
    /** 'YYYY-MM', in the business's timezone. */
    month: string
    source: 'checkout' | 'charge'
    reference: string
    jurisdiction: string
    /** What the customer paid, tax included. */
    total: number
    refunded: number
    taxLines: TaxLine[]
}

export type TaxReportRow = {
    month: string
    taxId: string
    label: string
    jurisdiction: string
    taxable: number
    collected: number
    refunded: number
    net: number
}

export function buildTaxReport(sales: TaxedSale[]): TaxReportRow[] {
    const rows = new Map<string, TaxReportRow>()

    for (const sale of sales) {
        const refundShare = sale.total > 0 ? Math.min(1, Math.max(0, sale.refunded / sale.total)) : 0
        for (const line of sale.taxLines) {
            const key = `${sale.month}|${line.id}|${sale.jurisdiction}`
            const row = rows.get(key) ?? {
                month: sale.month,
                taxId: line.id,
                label: line.label,
                jurisdiction: sale.jurisdiction,
                taxable: 0,
                collected: 0,
                refunded: 0,
                net: 0,
            }
            row.taxable = roundMoney(row.taxable + line.taxableAmount)
            row.collected = roundMoney(row.collected + line.amount)
            row.refunded = roundMoney(row.refunded + line.amount * refundShare)
            row.net = roundMoney(row.collected - row.refunded)
            rows.set(key, row)
        }
    }

    return [...rows.values()].sort((a, b) =>
        a.month.localeCompare(b.month) || a.jurisdiction.localeCompare(b.jurisdiction) || a.taxId.localeCompare(b.taxId))
}

export function taxReportCsv(rows: TaxReportRow[]): string {
    const header = ['Month', 'Jurisdiction', 'Tax', 'Taxable amount', 'Collected', 'Refunded', 'Net']
    const escape = (value: string | number) => {
        const s = String(value)
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    return [header, ...rows.map(r => [r.month, r.jurisdiction, r.label, r.taxable.toFixed(2), r.collected.toFixed(2), r.refunded.toFixed(2), r.net.toFixed(2)])]
        .map(cols => cols.map(escape).join(','))
        .join('\n')
}
