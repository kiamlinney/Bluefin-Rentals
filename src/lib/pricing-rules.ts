// The automatic pricing rules: reading them for quotes, and the admin
// functions behind /admin/pricing. The arithmetic itself is in pricing.ts
// (dailyPrice); this file is the storage and the validation around it.
//
// The pure helpers below are plain exports, used by the admin page as well as
// the handlers. Never re-export a .server.ts function from here: browser pages
// import this file.

import { createServerFn } from '@tanstack/react-start'
import { getServiceRoleClient, requireAdmin } from './access.server'
import { loadAdminChanges, recordAdminChange, type AdminChange } from './admin-changes.server'
import { loadPricingRules, type PricingPeriodRow, type PricingSettingsRow } from './pricing-rules.server'
import { DAY_ADJUSTMENT_LABEL, MULTIPLIER_MAX, MULTIPLIER_MIN, type PricingPeriodKind, type PricingRules } from './pricing'

// ── Limits ───────────────────────────────────────────────────────────────────

// The bounds live with the rest of the rule in pricing.ts, where the policy
// documents' checker can read them.
export { MULTIPLIER_MAX, MULTIPLIER_MIN }
export const PERIOD_LABEL_MAX = 80

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
/** Monday first, the way the page lists them. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export function validateMultiplier(value: unknown, name: string): string | null {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return `${name} is required.`
    const n = Number(value)
    if (!Number.isFinite(n)) return `${name} must be a number.`
    if (n < MULTIPLIER_MIN || n > MULTIPLIER_MAX) {
        return `${name} must be between ${MULTIPLIER_MIN} and ${MULTIPLIER_MAX}.`
    }
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
        return `${name} can have at most two decimal places.`
    }
    return null
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
function isDateKey(value: unknown): value is string {
    if (typeof value !== 'string' || !DATE_KEY.test(value)) return false
    const d = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

export type PeriodInput = { kind: PricingPeriodKind; label: string; startDate: string; endDate: string }

export function validatePeriod(input: PeriodInput): { ok: true; period: PeriodInput } | { ok: false; error: string } {
    if (input.kind !== 'busy' && input.kind !== 'slow') return { ok: false, error: 'Choose busy or slow.' }
    const label = String(input.label ?? '').trim().replace(/\s+/g, ' ')
    if (!label) return { ok: false, error: 'Give the period a name, like “State Fair”.' }
    if (label.length > PERIOD_LABEL_MAX) return { ok: false, error: `Keep the name under ${PERIOD_LABEL_MAX} characters.` }
    if (!isDateKey(input.startDate) || !isDateKey(input.endDate)) return { ok: false, error: 'Pick a start and an end date.' }
    if (input.endDate < input.startDate) return { ok: false, error: 'The end date is before the start date.' }
    return { ok: true, period: { kind: input.kind, label, startDate: input.startDate, endDate: input.endDate } }
}

export type StoredPeriod = PeriodInput & { id: string }

/** The first stored period that shares a date with this one (inclusive at both ends). */
export function findOverlappingPeriod(
    periods: readonly StoredPeriod[],
    candidate: PeriodInput,
    excludeId?: string,
): StoredPeriod | null {
    return periods.find(p => p.id !== excludeId && p.startDate <= candidate.endDate && candidate.startDate <= p.endDate) ?? null
}

/** The same month and day `years` later. February 29 becomes February 28 in a non-leap year. */
export function shiftYears(dateKey: string, years: number): string {
    const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number]
    const year = y + years
    const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate()
    return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

export function describePeriod(p: PeriodInput): string {
    return `${DAY_ADJUSTMENT_LABEL[p.kind]}: ${p.label}, ${p.startDate} to ${p.endDate}`
}

const weekdayList = (days: readonly number[]) =>
    WEEKDAY_ORDER.filter(d => days.includes(d)).map(d => WEEKDAY_NAMES[d].slice(0, 3)).join(', ') || 'none'

// ── For every quote ──────────────────────────────────────────────────────────

/**
 * The rules in force. Public: every visitor's car page and checkout price
 * trips with them, and they aren't secret (the prices show them anyway).
 */
export const getPricingRules = createServerFn({ method: 'GET' }).handler(async (): Promise<PricingRules> => {
    return loadPricingRules(getServiceRoleClient())
})

// ── The admin page ───────────────────────────────────────────────────────────

export type PricingRulesAdmin = {
    busyMultiplier: number
    slowMultiplier: number
    weekendMultiplier: number
    weekendDays: number[]
    updatedAt: string | null
    periods: StoredPeriod[]
    changes: AdminChange[]
}

export const getPricingRulesAdmin = createServerFn({ method: 'GET' }).handler(async (): Promise<PricingRulesAdmin> => {
    await requireAdmin()
    const admin = getServiceRoleClient()
    const [settings, periods, changes] = await Promise.all([
        admin.from('pricing_settings').select('*').eq('id', true).maybeSingle(),
        admin.from('pricing_periods').select('*').order('start_date', { ascending: true }),
        loadAdminChanges(admin, null),
    ])
    if (settings.error) throw new Error(settings.error.message)
    if (periods.error) throw new Error(periods.error.message)
    const s = settings.data as PricingSettingsRow | null
    if (!s) throw new Error('pricing_settings has no row; run the 20261014120000 migration')
    return {
        busyMultiplier: Number(s.busy_multiplier),
        slowMultiplier: Number(s.slow_multiplier),
        weekendMultiplier: Number(s.weekend_multiplier),
        weekendDays: (s.weekend_days ?? []).map(Number),
        updatedAt: s.updated_at ?? null,
        periods: ((periods.data ?? []) as PricingPeriodRow[]).map(p => ({
            id: p.id, kind: p.kind, label: p.label, startDate: p.start_date, endDate: p.end_date,
        })),
        changes,
    }
})

export const setPricingSettings = createServerFn({ method: 'POST' })
    .inputValidator((input: { busyMultiplier: number; slowMultiplier: number; weekendMultiplier: number; weekendDays: number[] }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        const error =
            validateMultiplier(data.busyMultiplier, 'The busy multiplier') ??
            validateMultiplier(data.slowMultiplier, 'The slow multiplier') ??
            validateMultiplier(data.weekendMultiplier, 'The weekend multiplier')
        if (error) throw new Error(error)
        const weekendDays = [...new Set((data.weekendDays ?? []).map(Number))]
        if (weekendDays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('Unknown weekday.')

        const admin = getServiceRoleClient()
        const { data: current, error: readErr } = await admin.from('pricing_settings').select('*').eq('id', true).maybeSingle()
        if (readErr) throw new Error(readErr.message)
        if (!current) throw new Error('pricing_settings has no row; run the 20261014120000 migration')

        const next = {
            busy_multiplier: Number(data.busyMultiplier),
            slow_multiplier: Number(data.slowMultiplier),
            weekend_multiplier: Number(data.weekendMultiplier),
            weekend_days: WEEKDAY_ORDER.filter(d => weekendDays.includes(d)),
        }
        const { error: writeErr } = await admin
            .from('pricing_settings')
            .update({ ...next, updated_at: new Date().toISOString(), updated_by: user.id })
            .eq('id', true)
        if (writeErr) throw new Error(writeErr.message)

        const was = current as PricingSettingsRow
        for (const field of ['busy_multiplier', 'slow_multiplier', 'weekend_multiplier'] as const) {
            if (Number(was[field]) !== next[field]) {
                await recordAdminChange(admin, { carId: null, field: `pricing.${field}`, oldValue: Number(was[field]), newValue: next[field], changedBy: user.id })
            }
        }
        const oldDays = (was.weekend_days ?? []).map(Number)
        if (weekdayList(oldDays) !== weekdayList(next.weekend_days)) {
            await recordAdminChange(admin, { carId: null, field: 'pricing.weekend_days', oldValue: weekdayList(oldDays), newValue: weekdayList(next.weekend_days), changedBy: user.id })
        }
        return { ok: true }
    })

async function readPeriods(admin: ReturnType<typeof getServiceRoleClient>): Promise<StoredPeriod[]> {
    const { data, error } = await admin.from('pricing_periods').select('*')
    if (error) throw new Error(error.message)
    return ((data ?? []) as PricingPeriodRow[]).map(p => ({ id: p.id, kind: p.kind, label: p.label, startDate: p.start_date, endDate: p.end_date }))
}

const OVERLAP_CODE = '23P01' // exclusion_violation

/** Adds a period, or changes one when `id` is given. */
export const savePricingPeriod = createServerFn({ method: 'POST' })
    .inputValidator((input: PeriodInput & { id?: string }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        const checked = validatePeriod(data)
        if (!checked.ok) throw new Error(checked.error)
        const period = checked.period

        const admin = getServiceRoleClient()
        const existing = await readPeriods(admin)
        const before = data.id ? existing.find(p => p.id === data.id) : undefined
        if (data.id && !before) throw new Error('That period no longer exists.')

        // Checked here for a readable message; the exclusion constraint is what
        // actually guarantees it, including against a second owner saving at
        // the same moment.
        const clash = findOverlappingPeriod(existing, period, data.id)
        if (clash) throw new Error(`That overlaps “${clash.label}” (${clash.startDate} to ${clash.endDate}). Periods can’t share a date.`)

        const row = { kind: period.kind, label: period.label, start_date: period.startDate, end_date: period.endDate }
        const { error } = data.id
            ? await admin.from('pricing_periods').update(row).eq('id', data.id)
            : await admin.from('pricing_periods').insert({ ...row, created_by: user.id })
        if (error) {
            if (error.code === OVERLAP_CODE) throw new Error('That overlaps another period. Periods can’t share a date.')
            throw new Error(error.message)
        }

        await recordAdminChange(admin, {
            carId: null,
            field: 'pricing.period',
            oldValue: before ? describePeriod(before) : null,
            newValue: describePeriod(period),
            changedBy: user.id,
        })
        return { ok: true }
    })

export const deletePricingPeriod = createServerFn({ method: 'POST' })
    .inputValidator((input: { id: string }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        const admin = getServiceRoleClient()
        const { data: removed, error } = await admin.from('pricing_periods').delete().eq('id', data.id).select()
        if (error) throw new Error(error.message)
        const row = (removed ?? [])[0] as PricingPeriodRow | undefined
        // Already gone (a second tab, a double click): nothing to log.
        if (row) {
            await recordAdminChange(admin, {
                carId: null,
                field: 'pricing.period',
                oldValue: describePeriod({ kind: row.kind, label: row.label, startDate: row.start_date, endDate: row.end_date }),
                newValue: null,
                changedBy: user.id,
            })
        }
        return { ok: true }
    })
