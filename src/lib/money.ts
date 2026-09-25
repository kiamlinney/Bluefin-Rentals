// The one rounding rule for every money value on the site.
//
// Its own module rather than living in pricing.ts, because extras.ts needs it
// too and pricing.ts imports extras.ts — putting it in either one makes the
// pair circular.
//
// Every money value is rounded to cents as it's produced, and totals are summed
// from the already-rounded lines. That's what guarantees the rows a customer
// reads in a breakdown add up to the total they're charged, rather than drifting
// a cent apart from it.
export function roundMoney(amount: number): number {
    return Math.round(amount * 100) / 100
}
