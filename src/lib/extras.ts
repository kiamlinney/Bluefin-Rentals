// Optional add-ons a guest can buy alongside the trip.
//
// Pure and isomorphic like pricing.ts and cancellation-policy.ts: the checkout
// picker, the server that actually charges, the receipt and the post-booking
// request page all price from this one module, so none of them can disagree
// about what an extra costs.
//
// ── Adding or removing an offering ───────────────────────────────────────────
// Edit one entry in EXTRAS below. Nothing else in the codebase enumerates
// extras — every surface iterates this array — so there is no second list to
// keep in sync and no component to update.

// Extension-ful: this module is reachable from scripts/verify-cancellation-policy.ts
// via pricing.ts, and `node --experimental-strip-types` resolves specifiers
// literally — a bare './money' is not found there even though Vite resolves it.
import { roundMoney } from './money.ts'

export type ExtraBilling = 'per-trip' | 'per-day'

export type ExtraDefinition = {
    // Stable identifier. It travels in the checkout URL and is written into
    // bookings.price_quote, so renaming an extra is safe but changing an id
    // orphans every booking that bought it. Same rule as PickupLocation.id.
    id: string
    name: string
    description: string
    price: number
    billing: ExtraBilling
    /**
     * Only offered during checkout, never as a post-booking request.
     *
     * For extras that are a *billing term* rather than something handed over at
     * pickup. Adding one after the trip is priced changes how the trip itself is
     * billed, which is not a thing a guest should be able to ask for after the
     * fact — see the unlimited-mileage entry below.
     */
    checkoutOnly?: boolean
}

export const EXTRAS: ExtraDefinition[] = [
    {
        id: 'prepaid-refuel',
        name: 'Prepaid refuel',
        price: 45,
        billing: 'per-trip',
        description:
            'Bring the car back at any fuel level and skip the refueling fee. Covers up to a full tank.',
    },
    {
        id: 'unlimited-mileage',
        name: 'Unlimited mileage',
        price: 80,
        billing: 'per-day',
        description:
            'Drive as far as you like. Removes the daily mileage allowance and the per-mile charge beyond it.',
        checkoutOnly: true,
    },
    {
        id: 'child-seat',
        name: 'Child seat',
        price: 25,
        billing: 'per-trip',
        description: 'A forward-facing child seat, installed and ready at pickup.',
    },
]

// The extra that changes how mileage is billed. Named because four different
// surfaces have to suppress the "N miles included, $X/mile after" line when
// it's present, and a string literal repeated in four files is how those drift.
export const UNLIMITED_MILEAGE_EXTRA_ID = 'unlimited-mileage'

export function findExtra(id: string): ExtraDefinition | undefined {
    return EXTRAS.find(extra => extra.id === id)
}

/**
 * The ids a guest may not request after checkout.
 *
 * Read by both the request form (to leave them out) and requestTripExtras (to
 * refuse them), so the rule has one definition rather than a list of ids
 * repeated in a page and a server function.
 */
export function checkoutOnlyExtraIds(): string[] {
    return EXTRAS.filter(extra => extra.checkoutOnly).map(extra => extra.id)
}

export function extraPriceLabel(extra: ExtraDefinition): string {
    return extra.billing === 'per-day' ? `$${extra.price}/day` : `$${extra.price}/trip`
}

// One priced extra, exactly as stored inside bookings.price_quote.
//
// `name` and `unitPrice` are snapshotted rather than looked up at render time,
// for the same reason QuoteDay carries its own price: a receipt opened next year
// has to show the catalogue the guest actually bought from, not today's prices.
// That also means an extra can be removed from EXTRAS without breaking the
// receipts of everyone who already bought it.
export type QuoteExtra = {
    id: string
    name: string
    billing: ExtraBilling
    unitPrice: number
    // billableDays for a per-day extra, 1 for a per-trip one.
    quantity: number
    amount: number
}

// Prices a selection of extra ids.
//
// Canonicalises as it goes — unknown ids dropped, duplicates collapsed, output
// ordered by EXTRAS order — so the same selection prices identically however it
// arrived: from a hand-edited URL, from a resumed checkout, or from the picker.
// That the output order is stable is load-bearing: createCheckoutSession
// compares canonicalised id lists to decide whether a pending booking needs
// re-quoting.
export function resolveExtras(
    ids: string[],
    billableDays: number,
): { items: QuoteExtra[]; total: number } {
    const wanted = new Set(ids)
    const days = Math.max(0, Math.floor(billableDays))

    const items: QuoteExtra[] = EXTRAS
        .filter(extra => wanted.has(extra.id))
        .map(extra => {
            const quantity = extra.billing === 'per-day' ? days : 1
            return {
                id: extra.id,
                name: extra.name,
                billing: extra.billing,
                unitPrice: extra.price,
                quantity,
                // Rounded as produced, like every other line in a quote, so the
                // rows in a breakdown add up to the number on the card.
                amount: roundMoney(extra.price * quantity),
            }
        })
        // A per-day extra on a zero-day trip costs nothing, and a $0 row in a
        // receipt is noise. Dropped rather than rendered.
        .filter(item => item.amount > 0)

    return {
        items,
        total: roundMoney(items.reduce((sum, item) => sum + item.amount, 0)),
    }
}

// ── URL encoding ─────────────────────────────────────────────────────────────
// Lives here so the wire format has exactly one definition. A comma-separated
// list of slugs rather than a JSON array: the router would percent-encode an
// array as JSON, which makes the checkout URL unreadable, and a CSV takes
// zod's .catch(undefined) cleanly.

export function parseExtraIds(csv: string | undefined): string[] {
    if (!csv) return []
    return csv.split(',').map(part => part.trim()).filter(Boolean)
}

export function serializeExtraIds(ids: string[]): string | undefined {
    // undefined rather than '' so the param drops out of the URL entirely when
    // nothing is selected, instead of leaving a bare `?extras=`.
    return ids.length ? ids.join(',') : undefined
}

// Whether a stored quote includes the mileage-changing extra. Takes a loose
// shape so callers can pass a legacy price_quote that has no `extras` key at
// all without narrowing it first.
export function hasUnlimitedMileage(
    quote: { extras?: { id: string }[] | null } | null | undefined,
): boolean {
    return !!quote?.extras?.some(extra => extra.id === UNLIMITED_MILEAGE_EXTRA_ID)
}

/**
 * The ids a trip has already bought.
 *
 * Used to keep an extra off the post-booking request form once it's on the
 * trip. Without it a guest could request unlimited mileage on a trip that
 * already has it, which is an incoherent ask and looks to them like the site
 * has no idea what they paid for.
 */
export function ownedExtraIds(
    quote: { extras?: { id: string }[] | null } | null | undefined,
): string[] {
    return (quote?.extras ?? []).map(extra => extra.id)
}
