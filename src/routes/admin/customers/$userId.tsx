import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, Ban, Check, ExternalLink, RefreshCw, Trash2, X } from 'lucide-react'
import {
    addCustomerNote,
    deleteCustomerNote,
    getCustomer,
    getCustomerIdentityImages,
    refreshCustomerIdentity,
    setCustomerLicenseNumber,
    setCustomerTags,
    type CustomerDetail,
    type CustomerIdentity,
} from '@/lib/crm'
import { ageOn, MAX_NOTE_LENGTH, SUGGESTED_TAGS } from '@/lib/crm-summary'
import { formatBusinessDate, formatBusinessDateTime, formatDateKey } from '@/lib/dates'
import { money } from '@/lib/email-template'
import { formatPhone } from '@/lib/profile'
import { TRIP_PHASE_LABEL, tripPhase } from '@/lib/booking-status'
import { cn } from '@/lib/utils'
import { BlockedChip, TagChip } from '@/components/admin/CustomerFlags'
import { BlockCustomerModal, UnblockCustomerModal } from '@/components/admin/BlockCustomerModal'
import { Stars } from '@/components/reviews/Stars'

// One customer: who they are, their licence as Stripe verified it, every trip,
// what they've paid, the owners' notes and tags, and blocking.
//
// The /admin layout has already checked the viewer is an admin, and every
// function in src/lib/crm.ts checks again, since they can be called directly.

export const Route = createFileRoute('/admin/customers/$userId')({
    loader: ({ params }) => getCustomer({ data: params.userId }),
    component: CustomerPage,
})

const LONG_DATE: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }

function CustomerPage() {
    const c = Route.useLoaderData()
    const router = useRouter()
    const [blocking, setBlocking] = useState(false)
    const [unblocking, setUnblocking] = useState(false)

    const p = c.profile
    const name = p.fullName || p.email || 'Unnamed account'
    const blocked = c.activeBlocks.length > 0
    const now = new Date()
    const upcoming = c.trips.filter(t => t.status === 'confirmed' && new Date(t.end_time) > now)
    const completed = c.trips.filter(t => t.status === 'completed' || (t.status === 'confirmed' && new Date(t.end_time) <= now))
    const reload = () => router.invalidate()

    return (
        <div className="py-8 md:py-12 px-4 md:px-8">
            <div className="max-w-6xl mx-auto">
                <Link
                    to="/admin/customers"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline"
                >
                    <ArrowLeft size={16} aria-hidden /> Customers
                </Link>

                {/* Header */}
                <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                        <div className="w-16 h-16 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-2xl">
                            {name[0]?.toUpperCase() ?? 'G'}
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-3xl font-bold text-black break-words">{name}</h1>
                            <p className="mt-1 text-sm text-muted">
                                {completed.length} trip{completed.length === 1 ? '' : 's'}
                                {p.createdAt && <> • Joined {formatBusinessDate(p.createdAt, LONG_DATE)}</>}
                                {p.isAdmin && <> • <strong className="text-black">Admin</strong></>}
                            </p>
                            <TagEditor userId={p.id} tags={c.tags} knownTags={c.knownTags} />
                        </div>
                    </div>
                    {!p.isAdmin && (
                        blocked ? (
                            <button
                                type="button"
                                onClick={() => setUnblocking(true)}
                                className="px-4 py-2 rounded-lg border border-line text-sm font-semibold hover:bg-subtle cursor-pointer"
                            >
                                Unblock
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setBlocking(true)}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-300 text-sm font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                            >
                                <Ban size={16} aria-hidden /> Block customer
                            </button>
                        )
                    )}
                </div>

                {blocked && (
                    <div className="mt-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
                        <div className="flex items-center gap-2"><BlockedChip /> <span className="text-sm font-bold text-red-800">This customer can't book</span></div>
                        <ul className="mt-2 space-y-1 text-sm text-ink">
                            {c.activeBlocks.map(b => (
                                <li key={b.id}>
                                    {b.reason}
                                    <span className="text-muted">
                                        {' '}• {formatBusinessDate(b.created_at, LONG_DATE)}
                                        {b.blockedByName && ` by ${b.blockedByName}`}
                                        {b.source === 'license_match' && ' • automatic: same licence as a blocked account'}
                                        {b.viaAccount && (
                                            <> • through their licence, blocked on{' '}
                                                <Link to="/admin/customers/$userId" params={{ userId: b.viaAccount.id }} className="underline">
                                                    {b.viaAccount.name || 'another account'}
                                                </Link>
                                            </>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {upcoming.length > 0 && (
                            <p className="mt-2 text-sm font-semibold text-red-800">
                                {upcoming.length === 1 ? 'They still have a confirmed trip below.' : `They still have ${upcoming.length} confirmed trips below.`}
                            </p>
                        )}
                    </div>
                )}

                <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
                    {/* Left: identity, contact, money */}
                    <div className="space-y-6">
                        <LicenseCard customer={c} onChange={reload} />
                        <Card title="Contact">
                            <Fields>
                                <Field label="Email">{p.email ? <a href={`mailto:${p.email}`} className="underline">{p.email}</a> : null}</Field>
                                <Field label="Phone">{p.phone ? <a href={`tel:${p.phone}`} className="underline">{formatPhone(p.phone)}</a> : null}</Field>
                                <Field label="Date of birth (entered)">{p.dateOfBirth ? formatDateKey(p.dateOfBirth, LONG_DATE) : null}</Field>
                                <Field label="Home address">
                                    {p.address ? <>{p.address}<br />{[p.city, p.state].filter(Boolean).join(', ')} {p.zip}</> : null}
                                </Field>
                                <Field label="Stripe customer">
                                    {p.stripeCustomerUrl ? <ExternalA href={p.stripeCustomerUrl}>Open in Stripe</ExternalA> : null}
                                </Field>
                            </Fields>
                        </Card>
                        <Card title="Money">
                            <Fields>
                                <Field label="Lifetime paid"><span className="font-bold tabular-nums">{money(c.money.lifetimePaid)}</span></Field>
                                <Field label="Refunded"><span className="tabular-nums">{money(c.money.refunded)}</span></Field>
                                <Field label="Deposits kept"><span className="tabular-nums">{money(c.money.depositsKept)}</span></Field>
                                <Field label="Owes">
                                    <span className={cn('tabular-nums', c.money.owed > 0 && 'font-bold text-red-700')}>{money(c.money.owed)}</span>
                                </Field>
                            </Fields>
                            <p className="mt-3 text-xs text-muted">
                                Net of refunds, the same way each reservation's Total Earnings is worked out. "Owes" is charges sent to them as a pay link and not paid yet.
                            </p>
                        </Card>
                    </div>

                    {/* Right: trips, notes, reviews, history */}
                    <div className="space-y-6">
                        <Card title={`Trips (${c.trips.filter(t => t.status !== 'expired').length})`}>
                            <TripList trips={c.trips} />
                        </Card>
                        <NotesCard userId={p.id} notes={c.notes} />
                        {c.reviews.length > 0 && (
                            <Card title="Reviews they wrote">
                                <ul className="divide-y divide-line">
                                    {c.reviews.map(r => (
                                        <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                                            <div className="flex items-center gap-2">
                                                <Stars rating={r.rating} size={16} />
                                                <span className="text-xs text-muted">{r.car} • {formatBusinessDate(r.createdAt, LONG_DATE)}</span>
                                                {r.removedAt && <span className="rounded bg-gray-100 px-1.5 text-xs">Removed</span>}
                                            </div>
                                            <p className="mt-1 text-sm whitespace-pre-line break-words">{r.body}</p>
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        )}
                        {c.blockHistory.length > 0 && (
                            <Card title="Block history">
                                <ul className="space-y-3 text-sm">
                                    {c.blockHistory.map(b => (
                                        <li key={b.id}>
                                            <p>
                                                <strong>Blocked</strong> {formatBusinessDate(b.created_at, LONG_DATE)}
                                                {b.blockedByName && ` by ${b.blockedByName}`}: {b.reason}
                                            </p>
                                            {b.lifted_at && (
                                                <p className="text-muted">
                                                    Lifted {formatBusinessDate(b.lifted_at, LONG_DATE)}
                                                    {b.liftedByName && ` by ${b.liftedByName}`}{b.lift_reason && `: ${b.lift_reason}`}
                                                </p>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        )}
                    </div>
                </div>
            </div>

            {blocking && (
                <BlockCustomerModal
                    userId={p.id}
                    name={name}
                    hasLicense={Boolean(c.identity?.licenseNumber)}
                    onClose={() => setBlocking(false)}
                    onDone={reload}
                />
            )}
            {unblocking && (
                <UnblockCustomerModal
                    userId={p.id}
                    name={name}
                    otherAccounts={c.activeBlocks.flatMap(b => (b.viaAccount ? [b.viaAccount] : []))}
                    onClose={() => setUnblocking(false)}
                    onDone={reload}
                />
            )}
        </div>
    )
}

// ── Layout pieces ────────────────────────────────────────────────────────────

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

function Fields({ children }: { children: ReactNode }) {
    return <dl className="space-y-2.5 text-sm">{children}</dl>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
            <dt className="text-muted">{label}</dt>
            <dd className="break-words text-ink">{children ?? <span className="text-muted">—</span>}</dd>
        </div>
    )
}

function ExternalA({ href, children }: { href: string; children: ReactNode }) {
    return (
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline">
            {children} <ExternalLink size={12} aria-hidden />
        </a>
    )
}

// ── The licence ──────────────────────────────────────────────────────────────

function LicenseCard({ customer, onChange }: { customer: CustomerDetail; onChange: () => Promise<void> }) {
    const p = customer.profile
    const id = customer.identity
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const refresh = async () => {
        setRefreshing(true)
        setError(null)
        try {
            await refreshCustomerIdentity({ data: p.id })
            await onChange()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not read the verification from Stripe.')
        } finally {
            setRefreshing(false)
        }
    }

    const refreshButton = p.hasIdentitySession && (
        <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink cursor-pointer disabled:opacity-50"
            title="Read the verification from Stripe again"
        >
            <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} aria-hidden /> {refreshing ? 'Reading…' : 'Refresh from Stripe'}
        </button>
    )

    if (!id) {
        return (
            <Card title="Driver's licence" action={refreshButton}>
                <p className="text-sm text-ink">
                    {p.identityVerified
                        ? 'Verified with Stripe Identity, but verified before the CRM kept a copy. Refresh from Stripe to fill in what Stripe still shares.'
                        : p.hasIdentitySession
                            ? 'Started ID verification but hasn\'t finished it.'
                            : 'Has not verified an ID yet. Every booking requires it, at checkout.'}
                </p>
                {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
            </Card>
        )
    }

    const age = id.dob ? ageOn(id.dob) : null
    const nextTripEnd = customer.trips
        .filter(t => t.status === 'confirmed' && new Date(t.end_time) > new Date())
        .map(t => t.end_time)
        .sort()[0]
    const today = new Date().toISOString().slice(0, 10)
    const expired = Boolean(id.expirationDate && id.expirationDate < today)
    const expiresBeforeTrip = Boolean(!expired && id.expirationDate && nextTripEnd && id.expirationDate < nextTripEnd.slice(0, 10))

    return (
        <Card title="Driver's licence" action={refreshButton}>
            {p.identityVerified && (
                <p className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-green-700">
                    <Check size={14} aria-hidden /> Verified by Stripe Identity
                    {id.verifiedAt && <span className="font-normal text-muted"> on {formatBusinessDate(id.verifiedAt, LONG_DATE)}</span>}
                </p>
            )}
            {(expired || expiresBeforeTrip) && (
                <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                    {expired ? 'This licence has expired.' : 'This licence expires before their next trip ends.'}
                </p>
            )}
            <Fields>
                <Field label="Legal name">{[id.firstName, id.lastName].filter(Boolean).join(' ') || null}</Field>
                <Field label="Date of birth">
                    {id.dob ? <>{formatDateKey(id.dob, LONG_DATE)}{age !== null && <span className="text-muted"> (age {age})</span>}</> : null}
                </Field>
                <Field label="Licence number">
                    {id.licenseNumber
                        ? <span className="font-mono">{id.licenseNumber}</span>
                        : <ManualLicense userId={p.id} onSaved={onChange} />}
                </Field>
                <Field label="Document">{documentLabel(id)}</Field>
                <Field label="Issued">{id.issuedDate ? formatDateKey(id.issuedDate, LONG_DATE) : null}</Field>
                <Field label="Expires">
                    {id.expirationDate
                        ? <span className={cn((expired || expiresBeforeTrip) && 'font-bold text-amber-800')}>{formatDateKey(id.expirationDate, LONG_DATE)}</span>
                        : null}
                </Field>
                <Field label="Address on the ID">
                    {id.address?.line1 ? (
                        <>
                            {id.address.line1}{id.address.line2 && <>, {id.address.line2}</>}<br />
                            {[id.address.city, id.address.state].filter(Boolean).join(', ')} {id.address.postal_code}
                        </>
                    ) : null}
                </Field>
            </Fields>

            {!id.sensitiveCaptured && (
                <p className="mt-3 text-xs text-muted">
                    Stripe only shares the date of birth, licence number and expiry for 48 hours after verification, and they
                    weren't captured in time. They're in the Stripe Dashboard.
                </p>
            )}

            {id.sameLicense.length > 0 && (
                <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <strong>Same licence on another account:</strong>{' '}
                    {id.sameLicense.map((o, i) => (
                        <span key={o.id}>
                            {i > 0 && ', '}
                            <Link to="/admin/customers/$userId" params={{ userId: o.id }} className="underline">{o.name || o.email || 'account'}</Link>
                        </span>
                    ))}
                </div>
            )}

            <IdentityPhotos userId={p.id} dashboardUrl={id.dashboardUrl} />
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </Card>
    )
}

function documentLabel(id: CustomerIdentity): string | null {
    const type = id.documentType === 'driving_license' ? "Driver's licence"
        : id.documentType === 'id_card' ? 'ID card'
            : id.documentType === 'passport' ? 'Passport'
                : id.documentType
    const where = [id.issuingState, id.issuingCountry].filter(Boolean).join(', ')
    if (!type && !where) return null
    return [type, where && `(${where})`].filter(Boolean).join(' ')
}

// The photos are fetched on request, not on page load: each link lasts 30
// seconds and every fetch is an access to someone's ID, which Stripe logs.
function IdentityPhotos({ userId, dashboardUrl }: { userId: string; dashboardUrl: string }) {
    const [state, setState] = useState<
        | { kind: 'idle' }
        | { kind: 'loading' }
        | { kind: 'shown'; images: { label: string; url: string }[] }
        | { kind: 'unavailable'; reason: string }
    >({ kind: 'idle' })

    const show = async () => {
        setState({ kind: 'loading' })
        try {
            const r = await getCustomerIdentityImages({ data: userId })
            setState(r.available ? { kind: 'shown', images: r.images } : { kind: 'unavailable', reason: r.reason })
        } catch (e: unknown) {
            setState({ kind: 'unavailable', reason: e instanceof Error ? e.message : 'Could not reach Stripe.' })
        }
    }

    return (
        <div className="mt-4 border-t border-gray-100 pt-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
                {state.kind !== 'shown' && (
                    <button
                        type="button"
                        onClick={show}
                        disabled={state.kind === 'loading'}
                        className="px-3 py-1.5 rounded-lg border border-line font-semibold hover:bg-subtle cursor-pointer disabled:opacity-50"
                    >
                        {state.kind === 'loading' ? 'Loading…' : 'Show licence photos'}
                    </button>
                )}
                <ExternalA href={dashboardUrl}>Open verification in Stripe</ExternalA>
            </div>
            {state.kind === 'unavailable' && (
                <p className="mt-2 text-xs text-muted">{state.reason} The photos are in the Stripe Dashboard.</p>
            )}
            {state.kind === 'shown' && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                    {state.images.map(img => (
                        <figure key={img.label}>
                            <img src={img.url} alt={img.label} className="w-full rounded-lg border border-line object-contain bg-gray-50" />
                            <figcaption className="mt-1 text-xs text-muted">{img.label}</figcaption>
                        </figure>
                    ))}
                </div>
            )}
        </div>
    )
}

function ManualLicense({ userId, onSaved }: { userId: string; onSaved: () => Promise<void> }) {
    const [open, setOpen] = useState(false)
    const [value, setValue] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    if (!open) {
        return (
            <span>
                <span className="text-muted">Not on file. </span>
                <button type="button" onClick={() => setOpen(true)} className="font-semibold underline cursor-pointer">Add from Stripe</button>
            </span>
        )
    }

    const save = async () => {
        setWorking(true)
        setError(null)
        try {
            await setCustomerLicenseNumber({ data: { userId, licenseNumber: value } })
            await onSaved()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not save it.')
            setWorking(false)
        }
    }

    return (
        <span className="block space-y-1.5">
            <input
                value={value}
                onChange={e => setValue(e.target.value)}
                autoComplete="off"
                placeholder="As shown in the Stripe Dashboard"
                className="w-full bg-surface border border-line rounded-lg px-2 py-1 text-sm font-mono"
            />
            <span className="flex gap-2">
                <button type="button" onClick={save} disabled={working || !value.trim()} className="text-xs font-bold underline cursor-pointer disabled:opacity-50">
                    {working ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setOpen(false)} disabled={working} className="text-xs text-muted cursor-pointer">Cancel</button>
            </span>
            {error && <span className="block text-xs text-red-700">{error}</span>}
        </span>
    )
}

// ── Trips ────────────────────────────────────────────────────────────────────

function TripList({ trips }: { trips: CustomerDetail['trips'] }) {
    const [showUnpaid, setShowUnpaid] = useState(false)
    const unpaid = trips.filter(t => t.status === 'expired' || t.status === 'failed')
    const shown = trips.filter(t => showUnpaid || (t.status !== 'expired' && t.status !== 'failed'))

    if (trips.length === 0) return <p className="text-sm text-muted">No bookings yet.</p>

    return (
        <>
            <ul className="divide-y divide-line">
                {shown.map(t => {
                    const phase = tripPhase(t)
                    return (
                        <li key={t.id}>
                            <Link
                                to="/admin/reservation/$bookingId"
                                params={{ bookingId: t.id }}
                                className="flex items-start justify-between gap-3 py-3 hover:bg-subtle -mx-2 px-2 rounded-lg"
                            >
                                <div className="min-w-0">
                                    <p className="font-semibold text-black">
                                        {t.cars ? `${t.cars.make} ${t.cars.model} ${t.cars.year}` : 'Car'}
                                    </p>
                                    <p className="text-sm text-muted">
                                        {formatBusinessDateTime(t.start_time)} to {formatBusinessDateTime(t.end_time)}
                                    </p>
                                    <p className="text-xs text-muted">#{t.id.slice(0, 8).toUpperCase()}{t.pickup_location && ` • ${t.pickup_location}`}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-semibold', phaseClass(phase))}>
                                        {TRIP_PHASE_LABEL[phase]}
                                    </span>
                                    <p className="mt-1 text-sm tabular-nums">{money(Number(t.total_price))}</p>
                                    {Number(t.refunded_amount) > 0 && (
                                        <p className="text-xs text-muted tabular-nums">refunded {money(Number(t.refunded_amount))}</p>
                                    )}
                                </div>
                            </Link>
                        </li>
                    )
                })}
            </ul>
            {unpaid.length > 0 && (
                <button type="button" onClick={() => setShowUnpaid(s => !s)} className="mt-2 text-xs font-semibold text-muted underline cursor-pointer">
                    {showUnpaid ? 'Hide' : 'Show'} {unpaid.length} unpaid checkout{unpaid.length === 1 ? '' : 's'}
                </button>
            )}
        </>
    )
}

function phaseClass(phase: ReturnType<typeof tripPhase>): string {
    switch (phase) {
        case 'upcoming': return 'bg-green-100 text-green-800'
        case 'in-progress': return 'bg-red-100 text-red-700'
        case 'canceled': return 'bg-gray-200 text-gray-700 line-through'
        case 'awaiting-payment': return 'bg-amber-100 text-amber-800'
        default: return 'bg-gray-100 text-gray-700'
    }
}

// ── Notes and tags ───────────────────────────────────────────────────────────

function NotesCard({ userId, notes }: { userId: string; notes: CustomerDetail['notes'] }) {
    const router = useRouter()
    const [body, setBody] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const add = async () => {
        setWorking(true)
        setError(null)
        try {
            await addCustomerNote({ data: { userId, body } })
            setBody('')
            await router.invalidate()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not save the note.')
        } finally {
            setWorking(false)
        }
    }

    const remove = async (noteId: string) => {
        if (!window.confirm('Delete this note? It can\'t be undone.')) return
        try {
            await deleteCustomerNote({ data: noteId })
            await router.invalidate()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not delete the note.')
        }
    }

    return (
        <Card title="Notes">
            <p className="-mt-2 mb-3 text-xs text-muted">Private to the owners. The customer never sees these.</p>
            <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                maxLength={MAX_NOTE_LENGTH}
                rows={3}
                disabled={working}
                placeholder="e.g. Called about the late return; very apologetic, paid the fee."
                className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:border-ink-400"
            />
            <div className="mt-2 flex justify-end">
                <button
                    type="button"
                    onClick={add}
                    disabled={working || !body.trim()}
                    className="px-3 py-1.5 rounded-lg bg-black text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
                >
                    {working ? 'Saving…' : 'Add note'}
                </button>
            </div>
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
            {notes.length > 0 && (
                <ul className="mt-4 divide-y divide-line">
                    {notes.map(n => (
                        <li key={n.id} className="py-3 group">
                            <div className="flex items-start justify-between gap-3">
                                <p className="text-sm whitespace-pre-line break-words">{n.body}</p>
                                <button
                                    type="button"
                                    onClick={() => remove(n.id)}
                                    className="shrink-0 text-muted hover:text-red-700 cursor-pointer"
                                    aria-label="Delete note"
                                >
                                    <Trash2 size={14} aria-hidden />
                                </button>
                            </div>
                            <p className="mt-1 text-xs text-muted">
                                {n.authorName ?? 'An owner'} • {formatBusinessDateTime(n.createdAt)}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    )
}

function TagEditor({ userId, tags, knownTags }: { userId: string; tags: string[]; knownTags: string[] }) {
    const router = useRouter()
    const [draft, setDraft] = useState('')
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const suggestions = [...new Set([...knownTags, ...SUGGESTED_TAGS])].filter(t => !tags.includes(t))

    const save = async (next: string[]) => {
        setWorking(true)
        setError(null)
        try {
            await setCustomerTags({ data: { userId, tags: next } })
            setDraft('')
            await router.invalidate()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not save tags.')
        } finally {
            setWorking(false)
        }
    }

    return (
        <div className="mt-3">
            <div className="flex flex-wrap items-center gap-1.5">
                {tags.map(t => (
                    <span key={t} className="inline-flex items-center">
                        <TagChip tag={t} className="pr-1" />
                        <button
                            type="button"
                            onClick={() => save(tags.filter(x => x !== t))}
                            disabled={working}
                            className="-ml-1 rounded-r bg-gray-100 px-1 py-0.5 text-gray-500 hover:text-red-700 cursor-pointer"
                            aria-label={`Remove tag ${t}`}
                        >
                            <X size={12} aria-hidden />
                        </button>
                    </span>
                ))}
                <form
                    onSubmit={e => { e.preventDefault(); if (draft.trim()) save([...tags, draft]) }}
                    className="inline-flex"
                >
                    <input
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        list={`tags-${userId}`}
                        disabled={working}
                        placeholder="+ Add tag"
                        maxLength={40}
                        className="w-28 rounded border border-dashed border-gray-300 bg-transparent px-2 py-0.5 text-xs focus:outline-none focus:border-gray-500"
                    />
                    <datalist id={`tags-${userId}`}>
                        {suggestions.map(t => <option key={t} value={t} />)}
                    </datalist>
                </form>
            </div>
            {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
        </div>
    )
}
