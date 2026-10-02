// Tax on rentals, and on every charge after checkout.
//
// Pure and isomorphic like pricing.ts: the checkout summary, the server that
// charges, the receipt and the refund all compute tax here, so none of them can
// disagree about it.
//
// ═══════════════════════════════════════════════════════════════════════════
// ▶▶ READ BEFORE TAKING REAL PAYMENTS ◀◀
//
// As of 2026-09-27 there is no accountant, and several facts below are
// PLACEHOLDERS — best readings of public sources, marked `confirmed: false`.
// Every one is listed, with how to answer it, in ImportantFiles/tax-todo.md,
// and the full reasoning with sources is in ImportantFiles/tax.md.
// When an answer comes in: change the constant here, set `confirmed: true`, and
// update both documents (scripts/verify-policy-docs.ts checks the numbers).
// ═══════════════════════════════════════════════════════════════════════════
//
// ── Why this isn't Stripe Tax ────────────────────────────────────────────────
// Stripe Tax calculates Minnesota sales tax, but not the 9.2% Motor Vehicle
// Rental Tax; it has no product tax code for vehicle rental; and it taxes by
// where the customer lives, while a rental is taxed where the car is picked up.
// https://docs.stripe.com/tax/supported-countries/united-states/collect-tax.md?tax-jurisdiction-united-states=minnesota
// https://docs.stripe.com/tax/tax-codes.md
//
// ── What Minnesota charges on a short-term vehicle rental ────────────────────
// Short-Term Rentals, MN Dept of Revenue:
//   https://www.revenue.state.mn.us/guide/short-term-rentals-0
//   - the general state sales tax, plus any local sales taxes;
//   - a 9.2% Motor Vehicle Rental Tax, on the same amount as the sales tax;
//   - a 5% Motor Vehicle Rental Fee, unless the business had no more than 20
//     vehicles available for rent, or $50,000 or less in fee-subject receipts,
//     in the prior calendar year;
//   - "short-term" means a lease "under an agreement for 28 days or less".
// Statute: https://www.revisor.mn.gov/statutes/cite/297A.64

import { roundMoney } from './money.ts'

// Turns every tax off at once — the calculation returns no lines. Left on:
// the owners decided (2026-09-27) to collect with the best available figures
// rather than none, and bookings are paused until launch anyway.
export const TAX_ENABLED = true

// False until an accountant (or the owners, from the Department of Revenue)
// has confirmed everything marked `confirmed: false` below. Nothing reads it to
// change behaviour; it is the flag the go-live checklist and
// scripts/verify-policy-docs.ts point at.
export const TAX_CONFIG_REVIEWED = false

export type TaxRate = {
    id: string
    label: string
    rate: number
    source: string
    confirmed: boolean
}

// ── State taxes ──────────────────────────────────────────────────────────────

/** Minnesota general sales tax. */
export const MN_STATE_SALES_TAX: TaxRate = {
    id: 'mn-sales',
    label: 'Minnesota sales tax',
    rate: 0.06875,
    source: 'https://www.revenue.state.mn.us/sites/default/files/2026-08/local-sales-and-use-tax-rate-guide-2026-q4.pdf',
    confirmed: true,
}

/** Motor Vehicle Rental Tax — short-term rentals only, same base as sales tax. */
export const MN_RENTAL_MOTOR_VEHICLE_TAX: TaxRate = {
    id: 'mn-rental-tax',
    label: 'Minnesota rental vehicle tax',
    rate: 0.092,
    source: 'https://www.revenue.state.mn.us/guide/short-term-rentals-0',
    confirmed: true,
}

/** Motor Vehicle Rental Fee — see RENTAL_FEE_APPLIES. */
export const MN_RENTAL_VEHICLE_FEE: TaxRate = {
    id: 'mn-rental-fee',
    label: 'Minnesota rental vehicle fee',
    rate: 0.05,
    source: 'https://www.revenue.state.mn.us/guide/short-term-rentals-0',
    confirmed: true,
}

// ▶ PLACEHOLDER. We believe Bluefin is exempt (no more than 20 vehicles
// for rent, or $50,000 or less in fee-subject receipts in the prior year), so
// the 5% fee is not charged. Re-check every January: the test is on the prior
// calendar year, so growth can end the exemption. tax-todo.md, item 2.
export const RENTAL_FEE_APPLIES = false

// ▶ PLACEHOLDER as to how it's applied. "Short-term" is an agreement for 28
// days or less. Read literally, a trip booked for longer is not a short-term
// rental and carries no rental tax (sales tax still applies) — but the
// Department also says the tax applies to "daily or weekly" rentals even when
// kept past 28 days, so an extension never changes a trip's classification:
// it's decided by the length booked. tax-todo.md, item 5.
export const SHORT_TERM_MAX_DAYS = 28

// ── Local taxes, by where the car is picked up ───────────────────────────────
//
// From the Department of Revenue's Local Sales and Use Tax Rate Guide effective
// 10/1/2026–12/31/2026 (published quarterly — rates change; re-check each
// quarter): https://www.revenue.state.mn.us/sites/default/files/2026-08/local-sales-and-use-tax-rate-guide-2026-q4.pdf
// The Metro Area taxes (0.75% transportation + 0.25% housing) apply across the
// seven-county metro. Each local rate below excludes the 6.875% state rate.

export type TaxJurisdictionId = 'saint-paul' | 'minneapolis' | 'hennepin-msp'

export type TaxJurisdiction = {
    id: TaxJurisdictionId
    name: string
    /** Local sales taxes only; the state rate is added separately. */
    local: TaxRate[]
}

const RATE_GUIDE = 'https://www.revenue.state.mn.us/sites/default/files/2026-08/local-sales-and-use-tax-rate-guide-2026-q4.pdf'

const METRO_AREA: TaxRate = {
    id: 'metro-area',
    label: 'Metro area sales tax',
    rate: 0.01,
    source: RATE_GUIDE,
    confirmed: true,
}

export const TAX_JURISDICTIONS: Record<TaxJurisdictionId, TaxJurisdiction> = {
    // The home base, 2033 Sargent Avenue. Rate guide row "St. Paul": metro
    // 1.00% + city 1.50% + county transit 0.50% = 3.00% local, 9.875% combined.
    'saint-paul': {
        id: 'saint-paul',
        name: 'Saint Paul (Ramsey County)',
        local: [
            METRO_AREA,
            { id: 'st-paul-city', label: 'Saint Paul sales tax', rate: 0.015, source: RATE_GUIDE, confirmed: true },
            { id: 'ramsey-transit', label: 'Ramsey County transit tax', rate: 0.005, source: RATE_GUIDE, confirmed: true },
        ],
    },
    // The Grand Hotel, downtown Minneapolis. County 0.15% + metro 1.00% + city
    // 0.50% + transit 0.50% = 2.15% local, 9.025% combined. ▶ The city row in
    // the guide's extracted text was ambiguous; this is the reading consistent
    // with the other Hennepin cities that have a city tax. tax-todo.md, item 3.
    minneapolis: {
        id: 'minneapolis',
        name: 'Minneapolis (Hennepin County)',
        local: [
            { id: 'hennepin-county', label: 'Hennepin County sales tax', rate: 0.0015, source: RATE_GUIDE, confirmed: false },
            METRO_AREA,
            { id: 'minneapolis-city', label: 'Minneapolis sales tax', rate: 0.005, source: RATE_GUIDE, confirmed: false },
            { id: 'hennepin-transit', label: 'Hennepin County transit tax', rate: 0.005, source: RATE_GUIDE, confirmed: false },
        ],
    },
    // MSP airport and the MSP light rail stop, Fort Snelling Unorganized
    // Territory, Hennepin County — no city tax. County 0.15% + metro 1.00% +
    // transit 0.50% = 1.65% local, 8.525% combined. ▶ The airport has its own
    // row in the guide that didn't extract cleanly, and airports can carry their
    // own charges. tax-todo.md, item 3.
    'hennepin-msp': {
        id: 'hennepin-msp',
        name: 'MSP Airport (Hennepin County)',
        local: [
            { id: 'hennepin-county', label: 'Hennepin County sales tax', rate: 0.0015, source: RATE_GUIDE, confirmed: false },
            METRO_AREA,
            { id: 'hennepin-transit', label: 'Hennepin County transit tax', rate: 0.005, source: RATE_GUIDE, confirmed: false },
        ],
    },
}

export const DEFAULT_TAX_JURISDICTION: TaxJurisdictionId = 'saint-paul'

/**
 * The jurisdiction for a pickup, by the same selection pickup.ts resolves.
 *
 * ▶ PLACEHOLDER for deliveries: a delivered car is probably taxed where it's
 * delivered, which could be any city within the delivery radius. Until that
 * lookup exists, deliveries use the home base's rates. tax-todo.md, item 3.
 */
export function taxJurisdictionForPickup(
    selection: { kind: 'home' } | { kind: 'listed'; id: string } | { kind: 'delivery' },
): TaxJurisdictionId {
    if (selection.kind === 'listed') {
        if (selection.id === 'grand-hotel') return 'minneapolis'
        if (selection.id === 'msp' || selection.id === 'msp-light-rail') return 'hennepin-msp'
    }
    return DEFAULT_TAX_JURISDICTION
}

export function isTaxJurisdiction(value: unknown): value is TaxJurisdictionId {
    return typeof value === 'string' && value in TAX_JURISDICTIONS
}

// ── What's taxable ───────────────────────────────────────────────────────────
//
// ▶ Every entry is a PLACEHOLDER (confirmed: false) except the rental itself.
// Minnesota taxes the rental's "sales price", and the Department's guidance
// doesn't itemise which rental-related charges that includes. Where unsure,
// the reading chosen is the one a rental company would most commonly apply.
// tax-todo.md, item 4.

export type Taxability = { taxable: boolean; confirmed: boolean; reason: string }

export const TAXABILITY: Record<string, Taxability> = {
    trip: { taxable: true, confirmed: true, reason: 'The rental of the vehicle itself — the thing the rental taxes are on.' },
    delivery: { taxable: true, confirmed: false, reason: 'Minnesota generally includes delivery charges in the taxable sales price of a taxable item.' },
    'extra:prepaid-refuel': { taxable: true, confirmed: false, reason: 'Treated as part of the rental charge. Motor fuel itself is exempt from sales tax, so this may not be.' },
    'extra:unlimited-mileage': { taxable: true, confirmed: false, reason: 'A mileage term of the rental, so part of the rental price.' },
    'extra:child-seat': { taxable: true, confirmed: false, reason: 'Equipment rented with the vehicle.' },
    mileage: { taxable: true, confirmed: false, reason: 'Per-mile charges are part of the rental price.' },
    fuel: { taxable: true, confirmed: false, reason: 'Treated as a rental charge; may be exempt as fuel.' },
    tolls: { taxable: false, confirmed: false, reason: 'A pass-through of a government charge, not a sale.' },
    cleaning: { taxable: true, confirmed: false, reason: 'Treated as a charge connected with the rental.' },
    'late-return': { taxable: true, confirmed: false, reason: 'Additional rental time.' },
    damage: { taxable: false, confirmed: false, reason: 'Reimbursement for damage, not a sale.' },
    other: { taxable: true, confirmed: false, reason: 'Unknown charges are taxed so as not to under-collect; the form shows the tax before charging.' },
}

export function isTaxable(taxKey: string): boolean {
    return (TAXABILITY[taxKey] ?? TAXABILITY.other!).taxable
}

// ── Calculation ──────────────────────────────────────────────────────────────

/** A priced line to be taxed, keyed by what kind of thing it is. */
export type TaxableLine = {
    /** A key of TAXABILITY, e.g. 'trip', 'damage', 'extra:child-seat'. */
    taxKey: string
    amount: number
}

/** One tax line on a quote or charge, snapshotted like QuoteDay.price. */
export type TaxLine = {
    /** Stable key, e.g. 'mn-sales'. */
    id: string
    /** As printed: "Minnesota sales tax". */
    label: string
    /** 0.06875 for 6.875%. */
    rate: number
    /** The amount this rate was applied to. */
    taxableAmount: number
    amount: number
    /** True while the rate or its application is unconfirmed (tax-todo.md). */
    placeholder: boolean
}

export type TaxContext = {
    jurisdiction: TaxJurisdictionId
    /** Whether the booking is a short-term rental (SHORT_TERM_MAX_DAYS). */
    shortTermRental: boolean
}

export function isShortTermRental(bookedBillableDays: number): boolean {
    return bookedBillableDays <= SHORT_TERM_MAX_DAYS
}

/**
 * The tax on a set of lines. Every charge and quote goes through this one
 * function, so the rules live in one place.
 *
 * Each rate is applied once to the sum of the taxable lines and rounded once,
 * per rate — the way the lines appear on a receipt.
 */
export function calculateTax(lines: TaxableLine[], context: TaxContext): { lines: TaxLine[]; total: number } {
    if (!TAX_ENABLED) return { lines: [], total: 0 }

    const base = roundMoney(lines.filter(line => isTaxable(line.taxKey)).reduce((sum, line) => sum + line.amount, 0))
    if (base <= 0) return { lines: [], total: 0 }

    const anyUnconfirmedTaxability = lines.some(line => line.amount > 0 && !(TAXABILITY[line.taxKey]?.confirmed ?? false))
    const jurisdiction = TAX_JURISDICTIONS[context.jurisdiction] ?? TAX_JURISDICTIONS[DEFAULT_TAX_JURISDICTION]

    const rates: TaxRate[] = [MN_STATE_SALES_TAX, ...jurisdiction.local]
    if (context.shortTermRental) {
        rates.push(MN_RENTAL_MOTOR_VEHICLE_TAX)
        if (RENTAL_FEE_APPLIES) rates.push(MN_RENTAL_VEHICLE_FEE)
    }

    const taxLines: TaxLine[] = rates.map(rate => ({
        id: rate.id,
        label: rate.label,
        rate: rate.rate,
        taxableAmount: base,
        amount: roundMoney(base * rate.rate),
        // A long trip's classification (no rental tax) is itself unconfirmed.
        placeholder: !rate.confirmed || anyUnconfirmedTaxability || !context.shortTermRental,
    }))

    return { lines: taxLines, total: roundMoney(taxLines.reduce((sum, line) => sum + line.amount, 0)) }
}

/**
 * The tax context a booking was quoted under, read off its stored quote, so
 * every later charge on the trip is taxed the same way the trip was.
 */
export function taxContextFromQuote(quote: { taxJurisdiction?: unknown; billableDays?: number } | null | undefined): TaxContext {
    return {
        jurisdiction: isTaxJurisdiction(quote?.taxJurisdiction) ? quote!.taxJurisdiction as TaxJurisdictionId : DEFAULT_TAX_JURISDICTION,
        shortTermRental: isShortTermRental(quote?.billableDays ?? 1),
    }
}

// ── How tax is shown ─────────────────────────────────────────────────────────
//
// Stored and filed per rate (the return reports each local tax by
// jurisdiction, and tax-report.ts reads the stored lines), but shown to people
// as the three taxes a guest would recognise from any rental counter: one sales
// tax, the rental tax, and the rental fee when it applies. The four slices of a
// Saint Paul sales tax are one 9.875% rate, and listing them separately read as
// four taxes piled on top of each other.

/** A tax line as a guest or owner sees it: several stored lines, grouped. */
export type DisplayTaxLine = {
    id: string
    /** With its rate, as printed: "Sales tax (9.875%)". */
    label: string
    rate: number
    amount: number
}

/** 0.09875 → "9.875%". */
export function formatTaxRate(rate: number): string {
    return `${(rate * 100).toFixed(3).replace(/\.?0+$/, '')}%`
}

// Stored ids that are not sales tax. Every other id — the state rate and each
// local one — is a slice of the sales tax. Read off the id rather than a flag on
// the line, so receipts snapshotted before this grouping existed group too.
const SEPARATELY_SHOWN: Record<string, string> = {
    [MN_RENTAL_MOTOR_VEHICLE_TAX.id]: MN_RENTAL_MOTOR_VEHICLE_TAX.label,
    [MN_RENTAL_VEHICLE_FEE.id]: MN_RENTAL_VEHICLE_FEE.label,
}

/** Groups stored tax lines for display: sales tax first, then the rental tax and fee. */
export function displayTaxLines(lines: Pick<TaxLine, 'id' | 'rate' | 'amount'>[]): DisplayTaxLine[] {
    const groups = new Map<string, { label: string; rate: number; amount: number }>()
    for (const line of lines) {
        const id = line.id in SEPARATELY_SHOWN ? line.id : 'sales-tax'
        const group = groups.get(id) ?? { label: SEPARATELY_SHOWN[line.id] ?? 'Sales tax', rate: 0, amount: 0 }
        group.rate += line.rate
        group.amount += line.amount
        groups.set(id, group)
    }
    return [...groups.entries()].map(([id, group]) => {
        // Summed in floating point; 0.06875 + 0.01 + 0.015 + 0.005 must print as 9.875%.
        const rate = Math.round(group.rate * 1e6) / 1e6
        return { id, label: `${group.label} (${formatTaxRate(rate)})`, rate, amount: roundMoney(group.amount) }
    })
}

/** "Taxes (est.)" rows collapse to one line on narrow summaries. */
export function taxTotalOf(lines: TaxLine[]): number {
    return roundMoney(lines.reduce((sum, line) => sum + line.amount, 0))
}
