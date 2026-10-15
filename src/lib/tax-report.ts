// The tax report: what tax was collected, and refunded, month by month — the
// figures a Minnesota sales tax return is filed from.
//
// Pure: it takes the rows the server reads (checkout quotes and ledger charges)
// and adds them up, so the arithmetic can't differ between the page and its CSV.
// The page's month summaries (buildTaxMonths) are built from the same rows as
// the CSV (buildTaxReport), so "You owe" is always the sum of the CSV's Net.
//
// ▶ Two conventions here are placeholders until an accountant confirms them
// (ImportantFiles/tax-todo.md, item 7):
//   - a sale is reported in the month it was paid — a checkout in the month the
//     booking was made, a later charge in the month it settled;
//   - a refund returns tax in proportion to the share of the payment refunded,
//     reported in the same month as the sale (not the month of the refund).

import { MN_STATE_SALES_TAX, sumTaxRates, taxDisplayGroup, type TaxLine } from './tax.ts'
import { roundMoney } from './money.ts'

export type TaxedSale = {
    /** 'YYYY-MM', in the business's timezone. */
    month: string
    source: 'checkout' | 'charge'
    /** The booking id for a checkout, the charge id for a later charge. */
    reference: string
    bookingId: string
    /** When it was paid (ISO): the booking's creation, or the charge's settlement. */
    date: string
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
    /** 0.015 for 1.5%. Shown on the page; not in the CSV. */
    rate: number
    jurisdiction: string
    taxable: number
    collected: number
    refunded: number
    net: number
}

/** The share of a payment that was refunded, 0 to 1. Its tax comes back in the same proportion. */
function refundShareOf(sale: Pick<TaxedSale, 'total' | 'refunded'>): number {
    return sale.total > 0 ? Math.min(1, Math.max(0, sale.refunded / sale.total)) : 0
}

export function buildTaxReport(sales: TaxedSale[]): TaxReportRow[] {
    const rows = new Map<string, TaxReportRow>()

    for (const sale of sales) {
        const refundShare = refundShareOf(sale)
        for (const line of sale.taxLines) {
            const key = `${sale.month}|${line.id}|${sale.jurisdiction}`
            const row = rows.get(key) ?? {
                month: sale.month,
                taxId: line.id,
                label: line.label,
                rate: line.rate,
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

// ── The page's month summaries ───────────────────────────────────────────────

/** One tax as a person reads it (sales tax, rental tax), for one place and month. */
export type TaxSummaryLine = {
    id: string
    label: string
    rate: number
    collected: number
    refunded: number
    owed: number
}

export type TaxPlace = {
    jurisdiction: string
    /**
     * The rental price these taxes were charged on, before refunds — once, not
     * once per tax. Every taxed sale carries the state sales tax, so its base is
     * the whole amount; the rental tax's can be smaller (trips over 28 days).
     */
    rentalPriceTaxed: number
    lines: TaxSummaryLine[]
    /** The CSV's rows for this place and month, for the "for the tax form" breakdown. */
    rows: TaxReportRow[]
}

export type TaxSaleSummary = TaxedSale & {
    taxCharged: number
    taxRefunded: number
    taxOwed: number
}

export type TaxMonth = {
    month: string
    collected: number
    refunded: number
    owed: number
    bookingCount: number
    chargeCount: number
    places: TaxPlace[]
    sales: TaxSaleSummary[]
}

/**
 * One sale's own tax, for the list of sales behind a month. Rounded once per
 * sale, so on a partial refund the list can differ from the month's total by a
 * cent; the month total (from the CSV's rows) is the figure that's filed.
 */
export function summarizeSale(sale: TaxedSale): TaxSaleSummary {
    const taxCharged = roundMoney(sale.taxLines.reduce((sum, line) => sum + line.amount, 0))
    const taxRefunded = roundMoney(taxCharged * refundShareOf(sale))
    return { ...sale, taxCharged, taxRefunded, taxOwed: roundMoney(taxCharged - taxRefunded) }
}

function summarizePlace(jurisdiction: string, rows: TaxReportRow[]): TaxPlace {
    const groups = new Map<string, { label: string; rows: TaxReportRow[] }>()
    for (const row of rows) {
        const { id, label } = taxDisplayGroup(row.taxId)
        const group = groups.get(id) ?? { label, rows: [] }
        group.rows.push(row)
        groups.set(id, group)
    }
    const lines = [...groups.entries()].map(([id, group]) => {
        const collected = roundMoney(group.rows.reduce((sum, r) => sum + r.collected, 0))
        const refunded = roundMoney(group.rows.reduce((sum, r) => sum + r.refunded, 0))
        return { id, label: group.label, rate: sumTaxRates(group.rows.map(r => r.rate)), collected, refunded, owed: roundMoney(collected - refunded) }
    })
    // Sales tax first, as on a receipt.
    lines.sort((a, b) => Number(b.id === 'sales-tax') - Number(a.id === 'sales-tax'))
    const stateRow = rows.find(r => r.taxId === MN_STATE_SALES_TAX.id)
    const rentalPriceTaxed = stateRow?.taxable ?? Math.max(0, ...rows.map(r => r.taxable))
    return { jurisdiction, rentalPriceTaxed, lines, rows }
}

/** The report grouped for the page: per month, what's owed, by place, and the sales behind it. */
export function buildTaxMonths(sales: TaxedSale[]): TaxMonth[] {
    const rows = buildTaxReport(sales)
    const months = [...new Set(rows.map(r => r.month))]

    return months.map(month => {
        const monthRows = rows.filter(r => r.month === month)
        const monthSales = sales
            .filter(s => s.month === month && s.taxLines.length > 0)
            .map(summarizeSale)
            .sort((a, b) => a.date.localeCompare(b.date))
        const places = [...new Set(monthRows.map(r => r.jurisdiction))]
            .map(jurisdiction => summarizePlace(jurisdiction, monthRows.filter(r => r.jurisdiction === jurisdiction)))
        const collected = roundMoney(monthRows.reduce((sum, r) => sum + r.collected, 0))
        const refunded = roundMoney(monthRows.reduce((sum, r) => sum + r.refunded, 0))
        return {
            month,
            collected,
            refunded,
            owed: roundMoney(collected - refunded),
            bookingCount: monthSales.filter(s => s.source === 'checkout').length,
            chargeCount: monthSales.filter(s => s.source === 'charge').length,
            places,
            sales: monthSales,
        }
    })
}
