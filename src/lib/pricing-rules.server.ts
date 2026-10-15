// Reading the automatic pricing rules (pricing_settings, pricing_periods).
//
// Server-only (.server.ts), for the same bundling reason as access.server.ts.
// Every quote the server computes, at checkout and for an extension, reads the
// rules through loadPricingRules, and the browser gets the very same rules
// through getPricingRules (pricing-rules.ts), so the price a guest is shown and
// the price Stripe charges come from one set of rules.

import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, todayInBusinessTz, type PricingPeriod, type PricingRules } from './pricing'

type AdminClient = SupabaseClient<any, any, any>

export type PricingSettingsRow = {
    busy_multiplier: number | string
    slow_multiplier: number | string
    weekend_multiplier: number | string
    weekend_days: number[] | null
    updated_at?: string | null
    updated_by?: string | null
}

export type PricingPeriodRow = {
    id: string
    kind: 'busy' | 'slow'
    label: string
    start_date: string
    end_date: string
    created_at?: string
    created_by?: string | null
}

/**
 * numeric columns can reach us as strings (the same hazard buildOverrideMap
 * guards against), so every multiplier goes through Number().
 */
export function rulesFromRows(settings: PricingSettingsRow | null, periods: PricingPeriodRow[]): PricingRules {
    return {
        busyMultiplier: Number(settings?.busy_multiplier ?? 1),
        slowMultiplier: Number(settings?.slow_multiplier ?? 1),
        weekendMultiplier: Number(settings?.weekend_multiplier ?? 1),
        weekendDays: (settings?.weekend_days ?? []).map(Number),
        periods: periods.map((p): PricingPeriod => ({
            kind: p.kind,
            startDate: p.start_date,
            endDate: p.end_date,
            label: p.label,
        })),
    }
}

/**
 * The rules in force, with the periods that haven't ended. A day before today
 * is kept too, so a trip quoted just after midnight on one side of the
 * timezone line still finds yesterday's period.
 *
 * Fails closed: if the rules can't be read, quoting fails, rather than
 * quietly charging base price on a busy weekend.
 */
export async function loadPricingRules(admin: AdminClient): Promise<PricingRules> {
    const since = addDays(todayInBusinessTz(), -1)
    const [settings, periods] = await Promise.all([
        admin.from('pricing_settings').select('*').eq('id', true).maybeSingle(),
        admin.from('pricing_periods').select('*').gte('end_date', since).order('start_date', { ascending: true }),
    ])
    if (settings.error) throw new Error(`pricing_settings read failed: ${settings.error.message}`)
    if (periods.error) throw new Error(`pricing_periods read failed: ${periods.error.message}`)
    if (!settings.data) throw new Error('pricing_settings has no row; run the 20261014120000 migration')
    return rulesFromRows(settings.data as PricingSettingsRow, (periods.data ?? []) as PricingPeriodRow[])
}
