import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, CalendarDays, ExternalLink, Star } from 'lucide-react'
import {
    getVehicle,
    setVehicleListed,
    setVehicleLockboxCode,
    setVehiclePricing,
    type VehicleDetail,
    type VehicleTrip,
} from '@/lib/vehicles'
import { getCarPriceOverrides } from '@/lib/db'
import { getPricingRules } from '@/lib/pricing-rules'
import {
    CHANGE_FIELD_LABEL,
    MAX_LOCKBOX_CODE,
    listingStatusOf,
    recallLookupUrl,
    validateDistanceFee,
    validatePricePerDay,
    type TripCount,
} from '@/lib/fleet-view'
import {
    addDays,
    buildOverrideMap,
    dailyPrice,
    DAY_ADJUSTMENT_LABEL,
    todayInBusinessTz,
    weekdayOf,
    type PriceOverrides,
    type PricingRules,
} from '@/lib/pricing'
import { DEFAULT_DISTANCE_FEE } from '@/lib/distance'
import { carMainImageUrl } from '@/lib/car-images'
import { carSlug } from '@/lib/slug'
import { formatBusinessDate, formatBusinessDateTime, formatDateKey } from '@/lib/dates'
import { money } from '@/lib/email-template'
import { formatAverage } from '@/lib/reviews'
import { cn } from '@/lib/utils'
import { ListingBadge, vehicleStatusText } from '@/components/admin/VehicleStatus'
import {
    DialogError,
    ModalShell,
    dialogInputClass,
    primaryButtonClass,
    secondaryButtonClass,
} from '@/components/trip/ModalShell'

// One car: list or unlist it, its base price and per-mile fee, its lockbox
// code, every trip it's been on (Bluefin and Turo), and who changed
// what. The /admin layout has already checked the viewer is an admin, and
// every function in src/lib/vehicles.ts checks again.

export const Route = createFileRoute('/admin/vehicles/$carId')({
    loader: async ({ params }) => {
        const [vehicle, pricingRules, overrides] = await Promise.all([
            getVehicle({ data: Number(params.carId) }),
            getPricingRules(),
            getCarPriceOverrides({ data: params.carId }),
        ])
        return { vehicle, pricingRules, overrides: buildOverrideMap(overrides) }
    },
    component: VehiclePage,
})

const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
const SHORT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

function VehiclePage() {
    const { vehicle: v, pricingRules, overrides } = Route.useLoaderData()
    const router = useRouter()
    const reload = () => router.invalidate()
    const car = v.car
    const listed = listingStatusOf(car) === 'listed'

    return (
        <div className="py-8 md:py-12 px-4 md:px-8">
            <div className="max-w-6xl mx-auto">
                <Link
                    to="/admin/vehicles"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline"
                >
                    <ArrowLeft size={16} aria-hidden /> Vehicles
                </Link>

                {/* Header */}
                <div className="mt-6 flex flex-wrap items-start gap-5">
                    <img
                        src={carMainImageUrl(car.id)}
                        alt={`${car.make} ${car.model} ${car.year}`}
                        className="w-full sm:w-56 aspect-[5/3] rounded-xl object-cover bg-gray-100"
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-3xl font-bold text-black">{car.make} {car.model} {car.year}</h1>
                            <ListingBadge isAvailable={car.is_available} />
                        </div>
                        <p className="mt-1 text-gray-700">{[car.trim, car.license_plate].filter(Boolean).join(' • ') || '—'}</p>
                        {v.vin && (
                            <p className="mt-1 text-sm text-gray-700">
                                VIN <span className="font-mono tracking-wide text-black">{v.vin}</span>
                                {' · '}
                                <a
                                    href={recallLookupUrl(v.vin)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 font-semibold underline"
                                >
                                    Check recalls <ExternalLink size={12} aria-hidden />
                                </a>
                            </p>
                        )}
                        <p className="mt-1 text-sm text-gray-600">{vehicleStatusText(v.status)}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <a
                                href={`/fleet/${carSlug(car)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
                            >
                                Public page <ExternalLink size={14} aria-hidden />
                            </a>
                            <Link
                                to="/admin/calendar"
                                // An unlisted car is hidden by the calendar's default
                                // filter, so ask for every listing status.
                                search={{ cars: [car.id], status: listed ? undefined : [] }}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
                            >
                                <CalendarDays size={14} aria-hidden /> Calendar
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Stats */}
                <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label="Collected" value={money(v.money.lifetimePaid)} hint="Bluefin trips, refunds and tax included" />
                    <Stat label="Trips" value={String(v.tripCount.total)} hint={tripCountHint(v.tripCount)} />
                    <Stat label="Booked" value={`${v.bookedDays} / 30`} hint="Days in the next 30" />
                    <Stat
                        label="Rating"
                        value={v.reviewCount ? <span className="inline-flex items-center gap-1">{formatAverage(v.rating)} <Star size={16} className="fill-gray-900" /></span> : '—'}
                        hint={`${v.reviewCount} ${v.reviewCount === 1 ? 'review' : 'reviews'}`}
                    />
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
                    <div className="space-y-6">
                        <ListingCard vehicle={v} onChange={reload} />
                        <PricingCard vehicle={v} rules={pricingRules} overrides={overrides} onChange={reload} />
                        <LockboxCard vehicle={v} onChange={reload} />
                    </div>
                    <div className="space-y-6">
                        <TripHistory trips={v.trips} />
                        <ChangeHistory changes={v.changes} />
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

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

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint: string }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-black">{value}</p>
            <p className="text-xs text-gray-500">{hint}</p>
        </div>
    )
}

// How the trip count adds up: "83 on Turo as of Oct 14 · 2 Turo since · 3 Bluefin".
function tripCountHint(c: TripCount): string {
    const bluefin = `${c.bluefin} Bluefin`
    if (c.turoBaseline === null || !c.turoBaselineAt) return `${bluefin} only; Turo count not entered`
    return `${c.turoBaseline} Turo as of ${formatBusinessDate(c.turoBaselineAt, SHORT_DATE)} · ${c.turoSince} Turo since · ${bluefin}`
}

const smallButton =
    'rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'

// ── Listing ──────────────────────────────────────────────────────────────────

function ListingCard({ vehicle: v, onChange }: { vehicle: VehicleDetail; onChange: () => void }) {
    const [confirming, setConfirming] = useState(false)
    const listed = listingStatusOf(v.car) === 'listed'
    return (
        <Card title="Listing">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <p className="font-semibold text-black">{listed ? 'Listed' : 'Unlisted'}</p>
                    <p className="text-sm text-gray-600">
                        {listed ? 'Guests can find and book this car.' : 'Guests can see its page but can’t book it.'}
                    </p>
                </div>
                <button type="button" className={smallButton} onClick={() => setConfirming(true)}>
                    {listed ? 'Unlist' : 'List'}
                </button>
            </div>
            {confirming && <ListingDialog vehicle={v} listed={listed} onClose={() => setConfirming(false)} onDone={onChange} />}
        </Card>
    )
}

function ListingDialog({
    vehicle: v,
    listed,
    onClose,
    onDone,
}: {
    vehicle: VehicleDetail
    listed: boolean
    onClose: () => void
    onDone: () => void
}) {
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const now = Date.now()
    const upcoming = v.trips
        .filter(t => (t.source === 'turo' || t.status === 'confirmed') && new Date(t.end).getTime() > now)
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

    const submit = async () => {
        setWorking(true)
        setError(null)
        try {
            await setVehicleListed({ data: { carId: v.car.id, listed: !listed } })
            onDone()
            onClose()
        } catch (e) {
            setError(errorText(e, 'Could not change the listing.'))
            setWorking(false)
        }
    }

    return (
        <ModalShell
            title={listed ? 'Unlist this car?' : 'List this car again?'}
            busy={working}
            onClose={onClose}
            footer={
                <>
                    <button type="button" className={secondaryButtonClass} disabled={working} onClick={onClose}>Cancel</button>
                    <button type="button" className={primaryButtonClass} disabled={working} onClick={submit}>
                        {working ? 'Saving…' : listed ? 'Unlist' : 'List'}
                    </button>
                </>
            }
        >
            {listed ? (
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink">
                    <li>Guests can’t book it. Its page stays up and says it isn’t available.</li>
                    <li>Any checkout in progress on this car is cancelled, so it can’t be paid.</li>
                    <li>
                        Trips already booked are not changed.
                        {upcoming.length > 0 && ' Cancel or move any of these from its reservation page:'}
                    </li>
                    <li>It stays listed on Turo until you unlist it there too.</li>
                </ul>
            ) : (
                <p className="text-sm text-ink">Guests will be able to find and book it again straight away.</p>
            )}
            {listed && upcoming.length > 0 && (
                <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                    {upcoming.map(t => (
                        <li key={t.id} className="flex justify-between gap-3 px-3 py-2">
                            <span>{t.guestName ?? 'Guest'}{t.source === 'turo' && ' (Turo)'}</span>
                            <span className="text-muted">{formatBusinessDate(t.start, SHORT_DATE)} – {formatBusinessDate(t.end, SHORT_DATE)}</span>
                        </li>
                    ))}
                </ul>
            )}
            <DialogError message={error} />
        </ModalShell>
    )
}

// ── Pricing ──────────────────────────────────────────────────────────────────

/** The next few days worth showing at this base price: today, the weekend, the next busy and slow periods. */
function previewDays(rules: PricingRules, today: string): { label: string; date: string }[] {
    const days = [{ label: 'Today', date: today }]
    for (let i = 0; i < 7; i++) {
        const date = addDays(today, i)
        if (rules.weekendDays.includes(weekdayOf(date)) && date !== today) {
            days.push({ label: 'Next weekend day', date })
            break
        }
    }
    for (const kind of ['busy', 'slow'] as const) {
        const period = rules.periods.find(p => p.kind === kind && p.endDate >= today)
        if (period) {
            days.push({ label: `${DAY_ADJUSTMENT_LABEL[kind]}: ${period.label ?? ''}`.trim(), date: period.startDate > today ? period.startDate : today })
        }
    }
    return days
}

function PricingCard({
    vehicle: v,
    rules,
    overrides,
    onChange,
}: {
    vehicle: VehicleDetail
    rules: PricingRules
    overrides: PriceOverrides
    onChange: () => void
}) {
    const storedPrice = String(Number(v.car.price_per_day))
    const storedFee = v.car.distance_fee === null ? '' : Number(v.car.distance_fee).toFixed(2)
    const [price, setPrice] = useState(storedPrice)
    const [fee, setFee] = useState(storedFee)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)

    const dirty = price !== storedPrice || fee !== storedFee
    const priceCheck = validatePricePerDay(price)
    const feeCheck = validateDistanceFee(fee)
    const preview = useMemo(() => previewDays(rules, todayInBusinessTz()), [rules])

    const save = async () => {
        if (!priceCheck.ok) return setError(priceCheck.error)
        if (!feeCheck.ok) return setError(feeCheck.error)
        setSaving(true)
        setError(null)
        try {
            await setVehiclePricing({ data: { carId: v.car.id, pricePerDay: priceCheck.value, distanceFee: feeCheck.value } })
            setSaved(true)
            onChange()
        } catch (e) {
            setError(errorText(e, 'Could not save the prices.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card title="Pricing">
            <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                    <span className="font-semibold text-black">Base daily price</span>
                    <div className="mt-1 flex items-center gap-1">
                        <span className="text-gray-500">$</span>
                        <input
                            inputMode="numeric"
                            value={price}
                            onChange={e => { setPrice(e.target.value); setSaved(false) }}
                            className={dialogInputClass}
                            aria-label="Base daily price in dollars"
                        />
                    </div>
                </label>
                <label className="block text-sm">
                    <span className="font-semibold text-black">Per-mile fee (max)</span>
                    <div className="mt-1 flex items-center gap-1">
                        <span className="text-gray-500">$</span>
                        <input
                            inputMode="decimal"
                            value={fee}
                            placeholder={DEFAULT_DISTANCE_FEE.toFixed(2)}
                            onChange={e => { setFee(e.target.value); setSaved(false) }}
                            className={dialogInputClass}
                            aria-label="Per-mile fee in dollars"
                        />
                    </div>
                </label>
            </div>

            <ul className="mt-3 space-y-1 text-xs text-gray-600">
                <li>
                    New quotes use these straight away. Trips already booked keep the price and the per-mile rate they were shown.
                    Extensions are priced at the current daily prices.
                </li>
                <li>
                    The per-mile fee is what a 2-day trip pays for each mile past its allowance. Longer trips pay less, in step
                    with the length discounts.
                </li>
                {v.upcomingCalendarPrices > 0 && (
                    <li>
                        {v.upcomingCalendarPrices} upcoming {v.upcomingCalendarPrices === 1 ? 'date has a price' : 'dates have prices'} typed
                        on the calendar, which stay as typed.
                    </li>
                )}
            </ul>

            {priceCheck.ok && (
                <div className="mt-4 rounded-lg bg-gray-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                        With the <Link to="/admin/pricing" className="underline">pricing rules</Link>
                    </p>
                    <ul className="mt-2 space-y-1 text-sm">
                        {preview.map(d => {
                            const priced = dailyPrice({ date: d.date, basePricePerDay: priceCheck.value, override: overrides[d.date], rules })
                            return (
                                <li key={`${d.label}-${d.date}`} className="flex justify-between gap-3">
                                    <span className="text-gray-700">
                                        {d.label} <span className="text-gray-500">({formatDateKey(d.date, { weekday: 'short', month: 'short', day: 'numeric' })})</span>
                                    </span>
                                    <span className="font-semibold text-black">
                                        ${priced.price}
                                        {priced.isOverride && <span className="ml-1 font-normal text-amber-700">calendar price</span>}
                                    </span>
                                </li>
                            )
                        })}
                    </ul>
                </div>
            )}

            <div className="mt-4 flex items-center gap-3">
                <button type="button" className={primaryButtonClass} disabled={!dirty || saving} onClick={save}>
                    {saving ? 'Saving…' : 'Save prices'}
                </button>
                {dirty && !saving && (
                    <button type="button" className="text-sm underline cursor-pointer" onClick={() => { setPrice(storedPrice); setFee(storedFee); setError(null) }}>
                        Undo
                    </button>
                )}
                {saved && !dirty && <span className="text-sm text-emerald-700">Saved</span>}
            </div>
            <div className="mt-3"><DialogError message={error} /></div>
        </Card>
    )
}

// ── Lockbox code ─────────────────────────────────────────────────────────────

function LockboxCard({ vehicle: v, onChange }: { vehicle: VehicleDetail; onChange: () => void }) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(v.lockboxCode ?? '')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const submit = async () => {
        setSaving(true)
        setError(null)
        try {
            await setVehicleLockboxCode({ data: { carId: v.car.id, code: draft.trim() || null } })
            setEditing(false)
            onChange()
        } catch (e) {
            setError(errorText(e, 'Could not save the lockbox code.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card
            title="Lockbox code"
            action={!editing && (
                <button type="button" className={smallButton} onClick={() => { setDraft(v.lockboxCode ?? ''); setError(null); setEditing(true) }}>
                    {v.lockboxCode ? 'Edit' : 'Add'}
                </button>
            )}
        >
            {editing ? (
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        value={draft}
                        maxLength={MAX_LOCKBOX_CODE}
                        onChange={e => setDraft(e.target.value)}
                        className={cn(dialogInputClass, 'flex-1 min-w-[10rem] font-mono')}
                        aria-label="Lockbox code"
                        autoFocus
                    />
                    <button type="button" className={primaryButtonClass} disabled={saving} onClick={submit}>
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" className={secondaryButtonClass} disabled={saving} onClick={() => setEditing(false)}>
                        Cancel
                    </button>
                </div>
            ) : (
                <p className={cn('text-lg font-mono tracking-wide', !v.lockboxCode && 'text-gray-400')}>{v.lockboxCode ?? 'Not set'}</p>
            )}
            <p className="mt-1 text-xs text-gray-600">
                Guests get it once their deposit hold is in place. The trip page always shows the current code; one
                already emailed doesn’t change.
            </p>
            {error && <div className="mt-2"><DialogError message={error} /></div>}
        </Card>
    )
}

// ── Trips ────────────────────────────────────────────────────────────────────

const TRIP_TABS = { all: 'All', upcoming: 'Upcoming', past: 'Past', canceled: 'Cancelled' } as const
type TripTab = keyof typeof TRIP_TABS

function tabOf(t: VehicleTrip, now: number): Exclude<TripTab, 'all'> {
    if (t.source === 'bluefin' && t.status === 'canceled') return 'canceled'
    return new Date(t.end).getTime() > now ? 'upcoming' : 'past'
}

const TRIP_SOURCES = { bluefin: 'Bluefin', turo: 'Turo' } as const
type TripSource = keyof typeof TRIP_SOURCES

const chipClass = (on: boolean) =>
    cn(
        'rounded-full border px-3 py-1 text-sm cursor-pointer',
        on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50',
    )

function TripHistory({ trips }: { trips: VehicleTrip[] }) {
    const [tab, setTab] = useState<TripTab>('all')
    // Bluefin trips only to start with; Turo can be added alongside them.
    const [sources, setSources] = useState<TripSource[]>(['bluefin'])
    const now = Date.now()
    const fromSources = trips.filter(t => sources.includes(t.source))
    const shown = tab === 'all' ? fromSources : fromSources.filter(t => tabOf(t, now) === tab)

    // At least one source stays on: turning off the last would only empty the list.
    const toggleSource = (source: TripSource) =>
        setSources(s => (s.includes(source) ? (s.length > 1 ? s.filter(x => x !== source) : s) : [...s, source]))

    return (
        <Card title={`Trip history (${fromSources.length})`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                    {(Object.keys(TRIP_TABS) as TripTab[]).map(key => (
                        <button key={key} type="button" onClick={() => setTab(key)} className={chipClass(tab === key)}>
                            {TRIP_TABS[key]}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2" role="group" aria-label="Show trips from">
                    {(Object.keys(TRIP_SOURCES) as TripSource[]).map(key => (
                        <button
                            key={key}
                            type="button"
                            aria-pressed={sources.includes(key)}
                            onClick={() => toggleSource(key)}
                            className={chipClass(sources.includes(key))}
                        >
                            {TRIP_SOURCES[key]}
                        </button>
                    ))}
                </div>
            </div>
            {shown.length === 0 ? (
                <p className="text-sm text-gray-500">No trips here.</p>
            ) : (
                <ul className="divide-y divide-gray-100">
                    {shown.map(t => <TripRow key={`${t.source}-${t.id}`} trip={t} />)}
                </ul>
            )}
        </Card>
    )
}

function TripRow({ trip: t }: { trip: VehicleTrip }) {
    const dates = `${formatBusinessDate(t.start, SHORT_DATE)} – ${formatBusinessDate(t.end, LONG_DATE)}`
    return (
        <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
            <div className="min-w-0">
                <p className="font-semibold text-black">
                    {t.source === 'bluefin' ? (
                        <Link to="/admin/reservation/$bookingId" params={{ bookingId: t.id }} className="hover:underline">{dates}</Link>
                    ) : dates}
                </p>
                <p className="text-gray-600">
                    {t.source === 'bluefin' ? (
                        <Link to="/admin/customers/$userId" params={{ userId: t.guestId }} className="hover:underline">
                            {t.guestName ?? 'Guest'}
                        </Link>
                    ) : (t.guestName ?? 'Turo guest')}
                </p>
            </div>
            <div className="flex items-center gap-3">
                <span
                    className={cn(
                        'rounded px-1.5 py-0.5 text-xs font-semibold',
                        t.source === 'turo' ? 'bg-violet-100 text-violet-800' : 'bg-emerald-50 text-emerald-800',
                    )}
                >
                    {t.source === 'turo' ? 'Turo' : 'Bluefin'}
                </span>
                <span className="text-gray-700">
                    {t.source === 'bluefin' ? t.phaseLabel : new Date(t.end).getTime() > Date.now() ? 'Booked' : 'Completed'}
                </span>
                {t.source === 'bluefin' && <span className="w-20 text-right font-semibold text-black">{money(t.collected)}</span>}
            </div>
        </li>
    )
}

// ── Change history ───────────────────────────────────────────────────────────

function changeText(c: VehicleDetail['changes'][number]): string {
    const label = CHANGE_FIELD_LABEL[c.field] ?? c.field
    if (c.field === 'lockbox_code') return `${label} ${c.newValue ?? 'changed'}`
    const show = (value: string | null) => {
        if (value === null) return 'none'
        if (c.field === 'price_per_day') return `$${value}`
        if (c.field === 'distance_fee') return `$${Number(value).toFixed(2)}/mi`
        return value
    }
    return `${label}: ${show(c.oldValue)} → ${show(c.newValue)}`
}

function ChangeHistory({ changes }: { changes: VehicleDetail['changes'] }) {
    return (
        <Card title="Change history">
            {changes.length === 0 ? (
                <p className="text-sm text-gray-500">Nothing changed from this page yet.</p>
            ) : (
                <ul className="space-y-2 text-sm">
                    {changes.map(c => (
                        <li key={c.id}>
                            <p className="text-black">{changeText(c)}</p>
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
