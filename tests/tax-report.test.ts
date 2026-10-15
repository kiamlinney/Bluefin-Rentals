// The admin tax report (/admin/business/tax-information): the CSV rows the
// return is filed from, and the month summaries the page leads with. The
// summaries are a different view of the same rows, so a month's "You owe" must
// always equal the sum of the CSV's Net for that month.

import { describe, expect, it } from 'vitest'
import { calculateTax, type TaxContext } from '../src/lib/tax'
import { roundMoney } from '../src/lib/money'
import { buildTaxMonths, buildTaxReport, taxReportCsv, type TaxedSale } from '../src/lib/tax-report'

function sale(
    month: string,
    source: TaxedSale['source'],
    reference: string,
    amount: number,
    context: TaxContext,
    refunded = 0,
    taxKey = 'trip',
): TaxedSale {
    const tax = calculateTax([{ taxKey, amount }], context)
    return {
        month,
        source,
        reference,
        bookingId: `booking-${reference}`,
        date: `${month}-15T12:00:00Z`,
        jurisdiction: context.jurisdiction,
        total: roundMoney(amount + tax.total),
        refunded,
        taxLines: tax.lines,
    }
}

const SAINT_PAUL: TaxContext = { jurisdiction: 'saint-paul', shortTermRental: true }

// A Saint Paul trip; a Minneapolis trip refunded 60%; a 30-day trip (no rental
// tax); an awkward partial refund; a cleaning charge paid the next month.
const SALES: TaxedSale[] = [
    sale('2026-10', 'checkout', 'a', 400, SAINT_PAUL),
    sale('2026-10', 'checkout', 'b', 250, { jurisdiction: 'minneapolis', shortTermRental: true }, 177.34),
    sale('2026-10', 'checkout', 'c', 3000, { jurisdiction: 'saint-paul', shortTermRental: false }),
    sale('2026-10', 'checkout', 'e', 123.45, SAINT_PAUL, 33.33),
    sale('2026-11', 'charge', 'd', 50, SAINT_PAUL, 0, 'cleaning'),
]

describe('tax report CSV', () => {
    it('is unchanged by the page redesign (output of the previous tax-report.ts for these sales)', () => {
        expect(taxReportCsv(buildTaxReport(SALES))).toBe([
            'Month,Jurisdiction,Tax,Taxable amount,Collected,Refunded,Net',
            '2026-10,minneapolis,Hennepin County sales tax,250.00,0.38,0.23,0.15',
            '2026-10,minneapolis,Hennepin County transit tax,250.00,1.25,0.75,0.50',
            '2026-10,minneapolis,Metro area sales tax,250.00,2.50,1.50,1.00',
            '2026-10,minneapolis,Minneapolis sales tax,250.00,1.25,0.75,0.50',
            '2026-10,minneapolis,Minnesota rental vehicle tax,250.00,23.00,13.80,9.20',
            '2026-10,minneapolis,Minnesota sales tax,250.00,17.19,10.31,6.88',
            '2026-10,saint-paul,Metro area sales tax,3523.45,35.23,0.28,34.95',
            '2026-10,saint-paul,Minnesota rental vehicle tax,523.45,48.16,2.58,45.58',
            '2026-10,saint-paul,Minnesota sales tax,3523.45,242.24,1.92,240.32',
            '2026-10,saint-paul,Ramsey County transit tax,3523.45,17.62,0.14,17.48',
            '2026-10,saint-paul,Saint Paul sales tax,3523.45,52.85,0.42,52.43',
            '2026-11,saint-paul,Metro area sales tax,50.00,0.50,0.00,0.50',
            '2026-11,saint-paul,Minnesota rental vehicle tax,50.00,4.60,0.00,4.60',
            '2026-11,saint-paul,Minnesota sales tax,50.00,3.44,0.00,3.44',
            '2026-11,saint-paul,Ramsey County transit tax,50.00,0.25,0.00,0.25',
            '2026-11,saint-paul,Saint Paul sales tax,50.00,0.75,0.00,0.75',
        ].join('\n'))
    })
})

describe('tax report month summaries', () => {
    const rows = buildTaxReport(SALES)
    const months = buildTaxMonths(SALES)
    const october = months.find(m => m.month === '2026-10')!
    const sum = (ns: number[]) => roundMoney(ns.reduce((a, b) => a + b, 0))

    it("each month's You owe, charged and given back are the CSV rows' totals", () => {
        expect(months.map(m => m.month)).toEqual(['2026-10', '2026-11'])
        for (const month of months) {
            const csv = rows.filter(r => r.month === month.month)
            expect(month.owed).toBe(sum(csv.map(r => r.net)))
            expect(month.collected).toBe(sum(csv.map(r => r.collected)))
            expect(month.refunded).toBe(sum(csv.map(r => r.refunded)))
            // and each place's grouped lines add up to the same
            expect(sum(month.places.flatMap(p => p.lines.map(l => l.owed)))).toBe(month.owed)
        }
        // Minneapolis 18.23 + Saint Paul 390.76, from the CSV above.
        expect(october.owed).toBe(408.99)
    })

    it('shows the rental price taxed once per place, not once per tax', () => {
        const saintPaul = october.places.find(p => p.jurisdiction === 'saint-paul')!
        // 400 + 3000 + 123.45, the state sales tax's base; the 30-day trip has no rental tax line.
        expect(saintPaul.rentalPriceTaxed).toBe(3523.45)
        expect(saintPaul.rows).toHaveLength(5)
        expect(october.places.find(p => p.jurisdiction === 'minneapolis')!.rentalPriceTaxed).toBe(250)
    })

    it('groups the slices of sales tax into one line, at the combined rate, before the rental tax', () => {
        const saintPaul = october.places.find(p => p.jurisdiction === 'saint-paul')!
        expect(saintPaul.lines.map(l => [l.id, l.rate])).toEqual([['sales-tax', 0.09875], ['mn-rental-tax', 0.092]])
        const minneapolis = october.places.find(p => p.jurisdiction === 'minneapolis')!
        expect(minneapolis.lines[0]!.rate).toBe(0.09025)
        // The breakdown rows carry each slice's own rate.
        expect(saintPaul.rows.find(r => r.taxId === 'st-paul-city')!.rate).toBe(0.015)
    })

    it('counts bookings and later charges, and lists each sale with its own tax', () => {
        expect([october.bookingCount, october.chargeCount]).toEqual([4, 0])
        const november = months.find(m => m.month === '2026-11')!
        expect([november.bookingCount, november.chargeCount]).toEqual([0, 1])
        expect(november.sales[0]!.bookingId).toBe('booking-d')

        const b = october.sales.find(s => s.reference === 'b')!
        expect(b.taxCharged).toBe(45.57)
        // 60% of the payment refunded → 60% of its tax back.
        expect(b.taxRefunded).toBe(27.34)
        expect(b.taxOwed).toBe(18.23)
        // Rounded per sale, the list is within a cent per sale of the filed total.
        expect(Math.abs(sum(october.sales.map(s => s.taxOwed)) - october.owed)).toBeLessThanOrEqual(0.01 * october.sales.length)
    })

    it('leaves a fully refunded sale owing nothing', () => {
        const full = sale('2026-12', 'checkout', 'f', 200, SAINT_PAUL)
        full.refunded = full.total
        const [december] = buildTaxMonths([full])
        expect(december!.owed).toBe(0)
        expect(december!.sales[0]!.taxOwed).toBe(0)
        expect(december!.places[0]!.rentalPriceTaxed).toBe(200)
    })
})
