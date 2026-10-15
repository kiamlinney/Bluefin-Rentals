import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, CopyPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import {
    MULTIPLIER_MAX,
    MULTIPLIER_MIN,
    PERIOD_LABEL_MAX,
    WEEKDAY_NAMES,
    WEEKDAY_ORDER,
    deletePricingPeriod,
    getPricingRulesAdmin,
    savePricingPeriod,
    setPricingSettings,
    shiftYears,
    validateMultiplier,
    validatePeriod,
    type PeriodInput,
    type PricingRulesAdmin,
    type StoredPeriod,
} from '@/lib/pricing-rules'
import { getAdminCars } from '@/lib/db'
import {
    addDays,
    dailyPrice,
    dayMultiplier,
    daysBetween,
    DAY_ADJUSTMENT_LABEL,
    todayInBusinessTz,
    weekdayOf,
    type PricingPeriodKind,
    type PricingRules,
} from '@/lib/pricing'
import { CHANGE_FIELD_LABEL, compareCarNames } from '@/lib/fleet-view'
import { formatBusinessDateTime, formatDateKey } from '@/lib/dates'
import { cn } from '@/lib/utils'
import {
    DialogError,
    ModalShell,
    dialogInputClass,
    primaryButtonClass,
    secondaryButtonClass,
} from '@/components/trip/ModalShell'

// The automatic pricing rules: busy, slow and weekend multipliers on every
// car's base price, and the busy and slow periods they apply to. The rule
// itself is src/lib/pricing.ts#dailyPrice; what's decided and why is
// ImportantFiles/pricing-rules.md.

export const Route = createFileRoute('/admin/pricing')({
    loader: async () => {
        const [rules, cars] = await Promise.all([getPricingRulesAdmin(), getAdminCars()])
        return { rules, cars }
    },
    component: PricingPage,
})

const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)
const times = (n: number) => `×${Number(n.toFixed(4))}`

function toRules(r: PricingRulesAdmin): PricingRules {
    return {
        busyMultiplier: r.busyMultiplier,
        slowMultiplier: r.slowMultiplier,
        weekendMultiplier: r.weekendMultiplier,
        weekendDays: r.weekendDays,
        periods: r.periods,
    }
}

function PricingPage() {
    const { rules, cars } = Route.useLoaderData()
    const router = useRouter()
    const reload = () => router.invalidate()

    return (
        <div className="py-8 md:py-12 px-4 md:px-8">
            <div className="max-w-6xl mx-auto">
                <Link
                    to="/admin/vehicles"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline"
                >
                    <ArrowLeft size={16} aria-hidden /> Vehicles
                </Link>
                <h1 className="mt-6 text-3xl font-bold text-black">Pricing</h1>
                <p className="mt-2 max-w-3xl text-sm text-gray-700">
                    Every car’s daily price is its base price (set on its vehicle page) times these multipliers, rounded to
                    whole dollars. A busy weekend day gets both. A price typed for a date on the calendar always wins, with
                    no multiplier on it. Trips already booked keep the price they were charged.
                </p>

                <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
                    <div className="space-y-6">
                        <MultipliersCard rules={rules} onChange={reload} />
                        <ChangeHistory changes={rules.changes} />
                    </div>
                    <div className="space-y-6">
                        <PeriodsCard periods={rules.periods} onChange={reload} />
                        <PreviewCard rules={toRules(rules)} cars={cars} />
                    </div>
                </div>
            </div>
        </div>
    )
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-black">{title}</h2>
                {action}
            </div>
            {children}
        </section>
    )
}

// ── Multipliers ──────────────────────────────────────────────────────────────

function MultipliersCard({ rules, onChange }: { rules: PricingRulesAdmin; onChange: () => void }) {
    const initial = {
        busy: String(rules.busyMultiplier),
        slow: String(rules.slowMultiplier),
        weekend: String(rules.weekendMultiplier),
        days: rules.weekendDays,
    }
    const [busy, setBusy] = useState(initial.busy)
    const [slow, setSlow] = useState(initial.slow)
    const [weekend, setWeekend] = useState(initial.weekend)
    const [days, setDays] = useState<number[]>(initial.days)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)

    const sameDays = days.length === initial.days.length && days.every(d => initial.days.includes(d))
    const dirty = busy !== initial.busy || slow !== initial.slow || weekend !== initial.weekend || !sameDays
    const n = (s: string) => Number(s)
    const allValid = [busy, slow, weekend].every(s => validateMultiplier(s, 'x') === null)

    const save = async () => {
        const invalid =
            validateMultiplier(busy, 'The busy multiplier') ??
            validateMultiplier(slow, 'The slow multiplier') ??
            validateMultiplier(weekend, 'The weekend multiplier')
        if (invalid) return setError(invalid)
        setSaving(true)
        setError(null)
        try {
            await setPricingSettings({ data: { busyMultiplier: n(busy), slowMultiplier: n(slow), weekendMultiplier: n(weekend), weekendDays: days } })
            setSaved(true)
            onChange()
        } catch (e) {
            setError(errorText(e, 'Could not save the multipliers.'))
        } finally {
            setSaving(false)
        }
    }

    const field = (label: string, value: string, set: (v: string) => void, hint: string) => (
        <label className="block text-sm">
            <span className="font-semibold text-black">{label}</span>
            <div className="mt-1 flex items-center gap-1">
                <span className="text-gray-500">×</span>
                <input
                    inputMode="decimal"
                    value={value}
                    onChange={e => { set(e.target.value); setSaved(false) }}
                    className={dialogInputClass}
                />
            </div>
            <span className="mt-0.5 block text-xs text-gray-500">{hint}</span>
        </label>
    )

    return (
        <Card title="Multipliers">
            <div className="grid gap-4 sm:grid-cols-3">
                {field('Busy', busy, setBusy, 'During busy periods')}
                {field('Slow', slow, setSlow, 'During slow periods')}
                {field('Weekend', weekend, setWeekend, 'On the days below')}
            </div>

            <fieldset className="mt-4">
                <legend className="text-sm font-semibold text-black">Weekend days</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                    {WEEKDAY_ORDER.map(d => {
                        const on = days.includes(d)
                        return (
                            <button
                                key={d}
                                type="button"
                                aria-pressed={on}
                                onClick={() => { setDays(on ? days.filter(x => x !== d) : [...days, d]); setSaved(false) }}
                                className={cn(
                                    'rounded-full border px-3 py-1 text-sm cursor-pointer',
                                    on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                                )}
                            >
                                {WEEKDAY_NAMES[d].slice(0, 3)}
                            </button>
                        )
                    })}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                    A trip is billed for each date from pickup on, so a Friday-to-Sunday trip is billed Friday and Saturday.
                </p>
            </fieldset>

            {allValid && (
                <ul className="mt-4 space-y-0.5 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                    <li>Busy weekend day: <strong className="text-black">{times(n(busy) * n(weekend))}</strong></li>
                    <li>Slow weekend day: <strong className="text-black">{times(n(slow) * n(weekend))}</strong></li>
                    <li className="pt-1 text-xs text-gray-500">
                        Allowed range {MULTIPLIER_MIN} to {MULTIPLIER_MAX}, to catch typos. The per-mile fee follows the trip’s
                        average daily price, so a busy trip pays the car’s full per-mile fee and a slow one pays less.
                    </li>
                </ul>
            )}

            <div className="mt-4 flex items-center gap-3">
                <button type="button" className={primaryButtonClass} disabled={!dirty || saving} onClick={save}>
                    {saving ? 'Saving…' : 'Save multipliers'}
                </button>
                {saved && !dirty && <span className="text-sm text-emerald-700">Saved</span>}
            </div>
            <div className="mt-3"><DialogError message={error} /></div>
        </Card>
    )
}

// ── Periods ──────────────────────────────────────────────────────────────────

const KIND_STYLE: Record<PricingPeriodKind, string> = {
    busy: 'bg-amber-100 text-amber-900',
    slow: 'bg-sky-100 text-sky-900',
}

type Editing = { mode: 'add' } | { mode: 'edit'; period: StoredPeriod } | { mode: 'copy'; period: StoredPeriod }

function PeriodsCard({ periods, onChange }: { periods: StoredPeriod[]; onChange: () => void }) {
    const [editing, setEditing] = useState<Editing | null>(null)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const today = todayInBusinessTz()
    const current = periods.filter(p => p.endDate >= today)
    const past = periods.filter(p => p.endDate < today).reverse()

    const remove = async (p: StoredPeriod) => {
        if (!window.confirm(`Delete “${p.label}”? Trips already booked keep their price.`)) return
        setBusyId(p.id)
        setError(null)
        try {
            await deletePricingPeriod({ data: { id: p.id } })
            onChange()
        } catch (e) {
            setError(errorText(e, 'Could not delete the period.'))
        } finally {
            setBusyId(null)
        }
    }

    const row = (p: StoredPeriod, isPast: boolean) => (
        <li key={p.id} className={cn('flex flex-wrap items-center justify-between gap-3 py-3', isPast && 'opacity-60')}>
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', KIND_STYLE[p.kind])}>{DAY_ADJUSTMENT_LABEL[p.kind]}</span>
                    <span className="font-semibold text-black">{p.label}</span>
                </div>
                <p className="text-sm text-gray-600">
                    {formatDateKey(p.startDate, LONG_DATE)} – {formatDateKey(p.endDate, LONG_DATE)}
                    {' '}· {daysBetween(p.startDate, p.endDate) + 1} days
                </p>
            </div>
            <div className="flex gap-1">
                <IconButton label="Copy to next year" onClick={() => setEditing({ mode: 'copy', period: p })}><CopyPlus size={16} /></IconButton>
                <IconButton label="Edit" onClick={() => setEditing({ mode: 'edit', period: p })}><Pencil size={16} /></IconButton>
                <IconButton label="Delete" disabled={busyId === p.id} onClick={() => remove(p)}><Trash2 size={16} /></IconButton>
            </div>
        </li>
    )

    return (
        <Card
            title="Busy and slow periods"
            action={
                <button type="button" className={cn(secondaryButtonClass, 'inline-flex items-center gap-1.5 py-1.5')} onClick={() => setEditing({ mode: 'add' })}>
                    <Plus size={16} aria-hidden /> Add period
                </button>
            }
        >
            {current.length === 0 ? (
                <p className="text-sm text-gray-500">No upcoming periods. Every day is priced at the base rate, plus the weekend multiplier.</p>
            ) : (
                <ul className="divide-y divide-gray-100">{current.map(p => row(p, false))}</ul>
            )}
            {past.length > 0 && (
                <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-gray-700">Past periods ({past.length})</summary>
                    <ul className="divide-y divide-gray-100">{past.map(p => row(p, true))}</ul>
                </details>
            )}
            <div className="mt-3"><DialogError message={error} /></div>
            {editing && <PeriodDialog editing={editing} onClose={() => setEditing(null)} onSaved={onChange} />}
        </Card>
    )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 cursor-pointer disabled:opacity-50"
        >
            {children}
        </button>
    )
}

function PeriodDialog({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: () => void }) {
    const start: PeriodInput =
        editing.mode === 'add'
            ? { kind: 'busy', label: '', startDate: '', endDate: '' }
            : editing.mode === 'edit'
                ? editing.period
                : {
                    ...editing.period,
                    startDate: shiftYears(editing.period.startDate, 1),
                    endDate: shiftYears(editing.period.endDate, 1),
                }
    const [form, setForm] = useState<PeriodInput>(start)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const set = (patch: Partial<PeriodInput>) => setForm(f => ({ ...f, ...patch }))

    const submit = async () => {
        const checked = validatePeriod(form)
        if (!checked.ok) return setError(checked.error)
        setSaving(true)
        setError(null)
        try {
            await savePricingPeriod({ data: { ...checked.period, id: editing.mode === 'edit' ? editing.period.id : undefined } })
            onSaved()
            onClose()
        } catch (e) {
            setError(errorText(e, 'Could not save the period.'))
            setSaving(false)
        }
    }

    const title = editing.mode === 'add' ? 'Add a period' : editing.mode === 'edit' ? 'Edit period' : 'Copy to next year'

    return (
        <ModalShell
            title={title}
            busy={saving}
            onClose={onClose}
            footer={
                <>
                    <button type="button" className={secondaryButtonClass} disabled={saving} onClick={onClose}>Cancel</button>
                    <button type="button" className={primaryButtonClass} disabled={saving} onClick={submit}>
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </>
            }
        >
            {editing.mode === 'copy' && (
                <p className="text-sm text-muted">Same dates a year later. Holidays that move (Thanksgiving, Easter) need their dates checked.</p>
            )}
            <div className="flex gap-2" role="radiogroup" aria-label="Kind">
                {(['busy', 'slow'] as const).map(kind => (
                    <button
                        key={kind}
                        type="button"
                        role="radio"
                        aria-checked={form.kind === kind}
                        onClick={() => set({ kind })}
                        className={cn(
                            'flex-1 rounded-lg border px-3 py-2 text-sm font-semibold cursor-pointer',
                            form.kind === kind ? 'border-ink bg-ink text-surface' : 'border-line text-ink hover:bg-subtle',
                        )}
                    >
                        {DAY_ADJUSTMENT_LABEL[kind]}
                    </button>
                ))}
            </div>
            <label className="block text-sm">
                <span className="font-semibold text-ink">Name</span>
                <input
                    value={form.label}
                    maxLength={PERIOD_LABEL_MAX}
                    placeholder="State Fair"
                    onChange={e => set({ label: e.target.value })}
                    className={cn(dialogInputClass, 'mt-1')}
                />
            </label>
            <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                    <span className="font-semibold text-ink">First day</span>
                    <input type="date" value={form.startDate} onChange={e => set({ startDate: e.target.value })} className={cn(dialogInputClass, 'mt-1')} />
                </label>
                <label className="block text-sm">
                    <span className="font-semibold text-ink">Last day</span>
                    <input type="date" value={form.endDate} min={form.startDate || undefined} onChange={e => set({ endDate: e.target.value })} className={cn(dialogInputClass, 'mt-1')} />
                </label>
            </div>
            <p className="text-xs text-muted">Both days included. Periods can’t overlap.</p>
            <DialogError message={error} />
        </ModalShell>
    )
}

// ── Preview ──────────────────────────────────────────────────────────────────

const PREVIEW_DAYS = 60

function PreviewCard({ rules, cars }: { rules: PricingRules; cars: { id: number; make: string; model: string; year: number; trim: string | null; license_plate: string | null; is_available: boolean | null; price_per_day: number }[] }) {
    const sorted = useMemo(() => [...cars].sort(compareCarNames), [cars])
    const [carId, setCarId] = useState<number | null>(sorted[0]?.id ?? null)
    const car = sorted.find(c => c.id === carId) ?? null
    const today = todayInBusinessTz()
    const days = Array.from({ length: PREVIEW_DAYS }, (_, i) => addDays(today, i))

    return (
        <Card title={`Next ${PREVIEW_DAYS} days`}>
            <label className="block text-sm">
                <span className="sr-only">Vehicle</span>
                <select
                    value={carId ?? ''}
                    onChange={e => setCarId(Number(e.target.value))}
                    className={dialogInputClass}
                >
                    {sorted.map(c => (
                        <option key={c.id} value={c.id}>
                            {c.make} {c.model} {c.year}{c.license_plate ? ` · ${c.license_plate}` : ''} (${Number(c.price_per_day)} base)
                        </option>
                    ))}
                </select>
            </label>
            <div className="mt-3 grid grid-cols-7 gap-1">
                {days.map(date => {
                    const m = dayMultiplier(rules, date)
                    const price = car ? dailyPrice({ date, basePricePerDay: Number(car.price_per_day), rules }).price : null
                    const kind = m.adjustments.find(a => a !== 'weekend') as PricingPeriodKind | undefined
                    const isWeekend = m.adjustments.includes('weekend')
                    return (
                        <div
                            key={date}
                            title={m.adjustments.map(a => DAY_ADJUSTMENT_LABEL[a]).join(' + ') || 'Base price'}
                            className={cn(
                                'rounded-md border px-1 py-1 text-center text-xs',
                                kind ? KIND_STYLE[kind] : isWeekend ? 'bg-gray-100' : 'bg-white',
                                kind ? 'border-transparent' : 'border-gray-100',
                            )}
                        >
                            <div className="text-[10px] text-gray-500">{WEEKDAY_NAMES[weekdayOf(date)]?.slice(0, 2)} {Number(date.slice(8))}</div>
                            <div className="font-semibold">{price === null ? '' : `$${price}`}</div>
                        </div>
                    )
                })}
            </div>
            <p className="mt-2 text-xs text-gray-500">
                Before any price typed on the calendar for a date, which would win. Amber is busy, blue is slow, grey is a
                weekend day.
            </p>
        </Card>
    )
}

// ── Change history ───────────────────────────────────────────────────────────

function ChangeHistory({ changes }: { changes: PricingRulesAdmin['changes'] }) {
    return (
        <Card title="Change history">
            {changes.length === 0 ? (
                <p className="text-sm text-gray-500">No changes yet.</p>
            ) : (
                <ul className="space-y-2 text-sm">
                    {changes.map(c => (
                        <li key={c.id}>
                            <p className="text-black">
                                {CHANGE_FIELD_LABEL[c.field] ?? c.field}:{' '}
                                {c.field === 'pricing.period'
                                    ? c.oldValue && c.newValue
                                        ? <>{c.oldValue} → {c.newValue}</>
                                        : c.newValue ? <>added {c.newValue}</> : <>deleted {c.oldValue}</>
                                    : <>{c.oldValue ?? 'none'} → {c.newValue ?? 'none'}</>}
                            </p>
                            <p className="text-xs text-gray-500">
                                {formatBusinessDateTime(c.createdAt, LONG_DATE)}
                                {c.changedByName && ` · ${c.changedByName}`}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    )
}
