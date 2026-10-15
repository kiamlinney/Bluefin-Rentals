// The automatic pricing rules: busy, slow and weekend multipliers on the base
// price (src/lib/pricing.ts#dailyPrice), stored in pricing_settings and
// pricing_periods and edited from /admin/pricing (src/lib/pricing-rules.ts).
//
// The rules Liam decided on 2026-10-13: multipliers multiply, a typed calendar
// price wins outright, weekend is Fri/Sat/Sun, periods are inclusive date
// ranges that never overlap, and every price is rounded to whole dollars.

import { describe, expect, it } from 'vitest'
import { h, signIn } from './harness'
import { world, paidTrip, setPricingRules, GUEST, ADMIN, CAR } from './fixtures'
import {
    calculateTripPrice,
    dailyPrice,
    groupQuoteDays,
    NO_PRICING_RULES,
    type PricingRules,
} from '../src/lib/pricing'
import { calculateExtensionPrice } from '../src/lib/extension'
import { createCheckoutSession } from '../src/lib/db'
import { previewExtension } from '../src/lib/payments.server'
import {
    deletePricingPeriod,
    findOverlappingPeriod,
    getPricingRules,
    getPricingRulesAdmin,
    savePricingPeriod,
    setPricingSettings,
    shiftYears,
    validateMultiplier,
    validatePeriod,
} from '../src/lib/pricing-rules'

// October 2026: the 15th is a Thursday, 16th Friday, 17th Saturday, 18th
// Sunday, 19th Monday.
const RULES: PricingRules = {
    busyMultiplier: 1.4,
    slowMultiplier: 0.85,
    weekendMultiplier: 1.1,
    weekendDays: [5, 6, 0],
    periods: [
        { kind: 'busy', startDate: '2026-10-16', endDate: '2026-10-17', label: 'Homecoming' },
        { kind: 'slow', startDate: '2026-11-02', endDate: '2026-11-05', label: 'Early November' },
    ],
}
const price = (date: string, base = 60, override?: number, rules = RULES) =>
    dailyPrice({ date, basePricePerDay: base, override, rules })

describe('one day’s price', () => {
    it('is the base price on a day no rule touches', () => {
        expect(price('2026-10-15')).toEqual({ price: 60, isOverride: false, adjustments: [] })
    })

    it('applies the weekend multiplier on Fri, Sat and Sun only', () => {
        expect(price('2026-10-18')).toEqual({ price: 66, isOverride: false, adjustments: ['weekend'] })
        expect(price('2026-10-19').price).toBe(60) // Monday
    })

    it('multiplies busy and weekend together, then rounds to whole dollars', () => {
        // 60 x 1.4 x 1.1 = 92.4
        expect(price('2026-10-16')).toEqual({ price: 92, isOverride: false, adjustments: ['busy', 'weekend'] })
        // 65 x 1.3: 84.5 lands on 85, not on 84 through floating-point error.
        expect(dailyPrice({ date: '2026-10-15', basePricePerDay: 65, rules: { ...RULES, busyMultiplier: 1.3, periods: [{ kind: 'busy', startDate: '2026-10-15', endDate: '2026-10-15' }] } }).price).toBe(85)
    })

    it('applies the slow multiplier, inclusive at both ends of the period', () => {
        expect(price('2026-11-02').price).toBe(51) // first day, a Monday
        expect(price('2026-11-05').price).toBe(51) // last day
        expect(price('2026-11-06').price).toBe(66) // the day after is a Friday, weekend only
        expect(price('2026-11-01').price).toBe(66) // the day before is a Sunday
    })

    it('lets a price typed on the calendar win outright', () => {
        expect(price('2026-10-16', 60, 75)).toEqual({ price: 75, isOverride: true, adjustments: [] })
    })

    it('with no rules, is exactly the price it always was (cents kept)', () => {
        expect(dailyPrice({ date: '2026-10-17', basePricePerDay: 59.5, rules: NO_PRICING_RULES }))
            .toEqual({ price: 59.5, isOverride: false, adjustments: [] })
    })
})

describe('a whole trip', () => {
    const trip = (rules: PricingRules) => calculateTripPrice({
        startDate: '2026-10-15', startTime: '10:00', endDate: '2026-10-19', endTime: '10:00',
        basePricePerDay: 60, pricingRules: rules, today: '2026-10-01',
    })

    it('prices each billed day by its own rules, across a period boundary', () => {
        const q = trip(RULES)
        // Thu 60, Fri busy+weekend 92, Sat busy+weekend 92, Sun weekend 66.
        expect(q.days.map(d => d.price)).toEqual([60, 92, 92, 66])
        expect(q.subtotal).toBe(310)
        // The length discount comes off the adjusted subtotal, as before.
        expect(q.discountAmount).toBe(15.5)
    })

    it('labels the adjusted runs in the breakdown', () => {
        expect(groupQuoteDays(trip(RULES).days).map(g => g.adjustmentLabel)).toEqual([null, 'Busy period + Weekend', 'Weekend'])
    })

    it('with no rules, matches a quote from before the rules existed', () => {
        const q = trip(NO_PRICING_RULES)
        expect(q.subtotal).toBe(240)
        // No adjustments key at all, so a stored quote looks exactly as it did.
        expect(q.days.every(d => !('adjustments' in d))).toBe(true)
    })

    it('prices an extension’s added days by the same rules', () => {
        const q = calculateExtensionPrice({
            startDate: '2026-10-13', startTime: '10:00',
            currentEndDate: '2026-10-15', currentEndTime: '10:00',
            newEndDate: '2026-10-17', newEndTime: '10:00',
            basePricePerDay: 60,
            pricingRules: RULES,
        })
        // Adds Thu (60) and Fri (busy + weekend, 92).
        expect(q.days.map(d => d.price)).toEqual([60, 92])
    })
})

describe('validation', () => {
    it('keeps multipliers between 0.5 and 3 with at most two decimals', () => {
        expect(validateMultiplier('1.4', 'Busy')).toBeNull()
        expect(validateMultiplier(0.5, 'Busy')).toBeNull()
        expect(validateMultiplier(14, 'Busy')).toMatch(/between/)
        expect(validateMultiplier(0.14, 'Busy')).toMatch(/between/)
        expect(validateMultiplier('1.405', 'Busy')).toMatch(/two decimal/)
        expect(validateMultiplier('', 'Busy')).toMatch(/required/)
        expect(validateMultiplier('abc', 'Busy')).toMatch(/number/)
    })

    it('needs a name and real dates in order', () => {
        expect(validatePeriod({ kind: 'busy', label: ' State  Fair ', startDate: '2027-08-26', endDate: '2027-09-06' }))
            .toEqual({ ok: true, period: { kind: 'busy', label: 'State Fair', startDate: '2027-08-26', endDate: '2027-09-06' } })
        expect(validatePeriod({ kind: 'busy', label: '', startDate: '2027-08-26', endDate: '2027-09-06' }).ok).toBe(false)
        expect(validatePeriod({ kind: 'busy', label: 'x', startDate: '2027-09-06', endDate: '2027-08-26' }).ok).toBe(false)
        expect(validatePeriod({ kind: 'busy', label: 'x', startDate: '2027-02-30', endDate: '2027-03-01' }).ok).toBe(false)
    })

    it('finds overlaps, sharing a single day included', () => {
        const stored = [{ id: 'a', kind: 'busy' as const, label: 'A', startDate: '2027-01-01', endDate: '2027-01-05' }]
        expect(findOverlappingPeriod(stored, { kind: 'slow', label: 'B', startDate: '2027-01-05', endDate: '2027-01-07' })?.id).toBe('a')
        expect(findOverlappingPeriod(stored, { kind: 'slow', label: 'B', startDate: '2027-01-06', endDate: '2027-01-07' })).toBeNull()
        // Editing a period doesn't clash with itself.
        expect(findOverlappingPeriod(stored, { kind: 'busy', label: 'A', startDate: '2027-01-02', endDate: '2027-01-06' }, 'a')).toBeNull()
    })

    it('copies a date to next year, Feb 29 becoming Feb 28', () => {
        expect(shiftYears('2026-08-27', 1)).toBe('2027-08-27')
        expect(shiftYears('2028-02-29', 1)).toBe('2029-02-28')
    })
})

// ── Stored, read and charged ─────────────────────────────────────────────────

const NOW = '2026-10-10T17:00:00Z'

function storeRules() {
    setPricingRules({ busy: 1.4, slow: 0.85, weekend: 1.1, weekendDays: [5, 6, 0] })
    h.db.insert('pricing_periods', { kind: 'busy', label: 'Homecoming', start_date: '2026-10-16', end_date: '2026-10-17' })
}

// Fri Oct 16 10am to Mon Oct 19 10am Central: billed Fri, Sat, Sun.
const weekendCheckout = () => ({
    carId: String(CAR),
    startTime: '2026-10-16T15:00:00Z',
    endTime: '2026-10-19T15:00:00Z',
    startDateLocal: '2026-10-16',
    startTimeLocal: '10:00',
    endDateLocal: '2026-10-19',
    endTimeLocal: '10:00',
    totalPrice: 0,
    pickupLocation: 'Home base',
})

describe('what a guest is charged', () => {
    it('is the price the car page and checkout quote with the same rules', async () => {
        world(NOW)
        storeRules()
        signIn(GUEST)

        // What the browser gets, and quotes with.
        const rules = await getPricingRules()
        const shown = calculateTripPrice({
            startDate: '2026-10-16', startTime: '10:00', endDate: '2026-10-19', endTime: '10:00',
            basePricePerDay: 60, pricingRules: rules,
        })

        const result = await createCheckoutSession({ data: weekendCheckout() })
        const booking = h.db.find('bookings', result.bookingId)!

        // Fri and Sat busy + weekend (92 each), Sun weekend (66).
        expect(booking.price_quote.subtotal).toBe(250)
        expect(booking.price_quote.subtotal).toBe(shown.subtotal)
        expect(Number(booking.total_price)).toBe(shown.total)
        expect(h.stripe.intents.get(booking.stripe_payment_intent_id)!.amount).toBe(Math.round(shown.total * 100))
    })

    it('lets a calendar price beat the rules at checkout too', async () => {
        world(NOW)
        storeRules()
        h.db.insert('car_price_overrides', { car_id: CAR, date: '2026-10-16', price: 70 })
        signIn(GUEST)
        const result = await createCheckoutSession({ data: weekendCheckout() })
        expect(h.db.find('bookings', result.bookingId)!.price_quote.subtotal).toBe(70 + 92 + 66)
    })

    it('prices an extension with the rules in force', async () => {
        world(NOW)
        storeRules()
        // Tue 10am to Thu 10am; extending to Sat 10am adds Thu and Fri.
        const { booking } = paidTrip({ start: '2026-10-13T15:00:00Z', end: '2026-10-15T15:00:00Z', bookedAt: '2026-10-01T15:00:00Z' })
        const preview = await previewExtension(h.db as any, booking.id, '2026-10-17', '10:00', new Date(NOW))
        expect(preview.quote.days.map(d => d.price)).toEqual([60, 92])
    })

    it('fails closed when the rules can’t be read, rather than charging base price', async () => {
        world(NOW)
        h.db.tables.pricing_settings = []
        signIn(GUEST)
        await expect(createCheckoutSession({ data: weekendCheckout() })).rejects.toThrow(/pricing_settings/)
        expect(h.stripe.intents.size).toBe(0)
    })
})

describe('the admin functions', () => {
    it('refuse a guest', async () => {
        world(NOW)
        signIn(GUEST)
        await expect(getPricingRulesAdmin()).rejects.toThrow('Not authorized')
        await expect(setPricingSettings({ data: { busyMultiplier: 2, slowMultiplier: 1, weekendMultiplier: 1, weekendDays: [] } })).rejects.toThrow('Not authorized')
        await expect(savePricingPeriod({ data: { kind: 'busy', label: 'x', startDate: '2026-12-01', endDate: '2026-12-02' } })).rejects.toThrow('Not authorized')
        await expect(deletePricingPeriod({ data: { id: 'x' } })).rejects.toThrow('Not authorized')
        expect(h.db.rows('pricing_periods')).toHaveLength(0)
        expect(Number(h.db.rows('pricing_settings')[0].busy_multiplier)).toBe(1)
    })

    it('save multipliers and log only what changed', async () => {
        world(NOW)
        signIn(ADMIN)
        await setPricingSettings({ data: { busyMultiplier: 1.4, slowMultiplier: 1, weekendMultiplier: 1.1, weekendDays: [0, 5, 6] } })
        const row = h.db.rows('pricing_settings')[0]
        expect([row.busy_multiplier, row.slow_multiplier, row.weekend_multiplier]).toEqual([1.4, 1, 1.1])
        expect(row.weekend_days).toEqual([5, 6, 0])
        expect(h.db.rows('admin_changes').map(c => c.field).sort())
            .toEqual(['pricing.busy_multiplier', 'pricing.weekend_days', 'pricing.weekend_multiplier'])

        await expect(setPricingSettings({ data: { busyMultiplier: 14, slowMultiplier: 1, weekendMultiplier: 1, weekendDays: [] } })).rejects.toThrow(/between/)
        expect(row.busy_multiplier).toBe(1.4)
    })

    it('refuse an overlapping period, and the database refuses it too', async () => {
        world(NOW)
        signIn(ADMIN)
        await savePricingPeriod({ data: { kind: 'busy', label: 'State Fair', startDate: '2027-08-26', endDate: '2027-09-06' } })
        await expect(savePricingPeriod({ data: { kind: 'slow', label: 'Labor Day', startDate: '2027-09-06', endDate: '2027-09-08' } }))
            .rejects.toThrow(/overlaps “State Fair”/)
        expect(h.db.rows('pricing_periods')).toHaveLength(1)

        // Two owners saving at once: the check passes for both, the constraint stops one.
        const { error } = await (h.db as any).from('pricing_periods')
            .insert({ kind: 'slow', label: 'Race', start_date: '2027-09-01', end_date: '2027-09-02' })
        expect(error?.code).toBe('23P01')
    })

    it('edit and delete a period, logging each', async () => {
        world(NOW)
        signIn(ADMIN)
        await savePricingPeriod({ data: { kind: 'busy', label: 'State Fair', startDate: '2027-08-26', endDate: '2027-09-06' } })
        const id = h.db.rows('pricing_periods')[0].id
        await savePricingPeriod({ data: { id, kind: 'busy', label: 'State Fair', startDate: '2027-08-27', endDate: '2027-09-07' } })
        expect(h.db.rows('pricing_periods')[0].start_date).toBe('2027-08-27')
        await deletePricingPeriod({ data: { id } })
        await deletePricingPeriod({ data: { id } }) // a second click logs nothing
        expect(h.db.rows('pricing_periods')).toHaveLength(0)
        expect(h.db.rows('admin_changes').map(c => [c.old_value === null, c.new_value === null]))
            .toEqual([[true, false], [false, false], [false, true]])
    })
})
