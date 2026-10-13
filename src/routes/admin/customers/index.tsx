import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { ArrowDown, ArrowUp, Check, Download, Search } from 'lucide-react'
import { listCustomers, type CustomerListRow } from '@/lib/crm'
import { toCsv } from '@/lib/crm-summary'
import { formatBusinessDate } from '@/lib/dates'
import { money } from '@/lib/email-template'
import { formatPhone } from '@/lib/profile'
import { cn } from '@/lib/utils'
import { BlockedChip, TagChip } from '@/components/admin/CustomerFlags'

// Every account, searchable and sortable, with a CSV export. The filters and
// sort live in the URL, so coming back from a customer keeps them.
//
// The export leaves out the licence number and date of birth on purpose: a
// spreadsheet gets forwarded and synced, and that data should stay on the
// customer page.

const FILTERS = {
    all: 'All',
    verified: 'ID verified',
    unverified: 'Not verified',
    upcoming: 'Upcoming trip',
    owes: 'Owes money',
    blocked: 'Blocked',
} as const
type Filter = keyof typeof FILTERS

const SORTS = {
    name: 'Name',
    trips: 'Trips',
    paid: 'Lifetime paid',
    next: 'Next trip',
    last: 'Last trip',
    joined: 'Joined',
} as const
type Sort = keyof typeof SORTS

type CustomersSearch = { q?: string; filter?: Filter; tag?: string; sort?: Sort; desc?: boolean }

export const Route = createFileRoute('/admin/customers/')({
    validateSearch: (search: Record<string, unknown>): CustomersSearch => ({
        q: typeof search.q === 'string' && search.q ? search.q : undefined,
        filter: typeof search.filter === 'string' && search.filter in FILTERS ? search.filter as Filter : undefined,
        tag: typeof search.tag === 'string' && search.tag ? search.tag : undefined,
        sort: typeof search.sort === 'string' && search.sort in SORTS ? search.sort as Sort : undefined,
        desc: search.desc === true || search.desc === 'true' ? true : undefined,
    }),
    loader: () => listCustomers(),
    component: CustomersPage,
})

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
const shortDate = (iso: string | null) => (iso ? formatBusinessDate(iso, SHORT_DATE) : '')

function matches(c: CustomerListRow, q: string): boolean {
    if (!q) return true
    const needle = q.toLowerCase()
    const digits = q.replace(/\D/g, '')
    return (
        (c.name ?? '').toLowerCase().includes(needle) ||
        (c.email ?? '').toLowerCase().includes(needle) ||
        (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits))
    )
}

function passesFilter(c: CustomerListRow, filter: Filter): boolean {
    switch (filter) {
        case 'all': return true
        case 'verified': return c.identityVerified
        case 'unverified': return !c.identityVerified
        case 'upcoming': return c.nextTripStart !== null
        case 'owes': return c.owed > 0
        case 'blocked': return c.blockReason !== null
    }
}

// Missing values sort last whichever way the column runs.
function compare(a: CustomerListRow, b: CustomerListRow, sort: Sort): number {
    const nullsLast = (x: string | null, y: string | null) =>
        x === y ? 0 : x === null ? 1 : y === null ? -1 : x.localeCompare(y)
    switch (sort) {
        case 'name': return (a.name || a.email || '').localeCompare(b.name || b.email || '')
        case 'trips': return a.trips - b.trips
        case 'paid': return a.lifetimePaid - b.lifetimePaid
        case 'next': return nullsLast(a.nextTripStart, b.nextTripStart)
        case 'last': return nullsLast(a.lastTripEnd, b.lastTripEnd)
        case 'joined': return nullsLast(a.createdAt, b.createdAt)
    }
}

function CustomersPage() {
    const customers = Route.useLoaderData()
    const search = Route.useSearch()
    const navigate = useNavigate({ from: Route.fullPath })

    const q = search.q ?? ''
    const filter = search.filter ?? 'all'
    const sort = search.sort ?? 'joined'
    // Newest first is the useful default for "joined"; everything else ascends.
    const desc = search.desc ?? (search.sort === undefined)

    const setSearch = (patch: Partial<CustomersSearch>) =>
        navigate({ search: prev => ({ ...prev, ...patch }), replace: true })

    const allTags = useMemo(
        () => [...new Set(customers.flatMap(c => c.tags))].sort((a, b) => a.localeCompare(b)),
        [customers],
    )

    const rows = useMemo(() => {
        const filtered = customers.filter(c =>
            matches(c, q) && passesFilter(c, filter) && (!search.tag || c.tags.includes(search.tag)))
        const sorted = [...filtered].sort((a, b) => compare(a, b, sort))
        if (desc) {
            // Reverse, but keep missing dates at the bottom.
            const present = sorted.filter(r => sortValuePresent(r, sort)).reverse()
            return [...present, ...sorted.filter(r => !sortValuePresent(r, sort))]
        }
        return sorted
    }, [customers, q, filter, search.tag, sort, desc])

    const toggleSort = (next: Sort) =>
        setSearch(next === sort ? { sort: next, desc: !desc } : { sort: next, desc: next === 'paid' || next === 'trips' || next === 'joined' })

    const exportCsv = () => {
        const csv = toCsv(
            ['Name', 'Email', 'Phone', 'City', 'State', 'ID verified', 'Trips', 'Cancelled', 'Lifetime paid', 'Owed',
                'Next trip', 'Last trip', 'Joined', 'Tags', 'Blocked', 'Block reason'],
            rows.map(c => [
                c.name, c.email, c.phone, c.city, c.state, c.identityVerified ? 'Yes' : 'No', c.trips, c.canceled,
                c.lifetimePaid.toFixed(2), c.owed.toFixed(2), shortDate(c.nextTripStart), shortDate(c.lastTripEnd),
                shortDate(c.createdAt), c.tags.join('; '), c.blockReason ? 'Yes' : 'No', c.blockReason,
            ]),
        )
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
        const a = document.createElement('a')
        a.href = url
        a.download = `bluefin-customers-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="py-8 md:py-16 px-4 md:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl text-black font-bold">Customers</h1>
                        <p className="mt-1 text-sm text-muted">
                            {rows.length === customers.length
                                ? `${customers.length} accounts`
                                : `${rows.length} of ${customers.length} accounts`}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={exportCsv}
                        disabled={rows.length === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-line text-sm font-semibold hover:bg-subtle transition-colors cursor-pointer disabled:opacity-50"
                    >
                        <Download size={16} aria-hidden /> Export CSV
                    </button>
                </div>

                <div className="flex flex-col gap-3 mb-6">
                    <label className="relative block max-w-md">
                        <span className="sr-only">Search customers</span>
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                        <input
                            type="search"
                            value={q}
                            onChange={e => setSearch({ q: e.target.value || undefined })}
                            placeholder="Search name, email or phone"
                            className="w-full bg-surface border border-line rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-ink-400"
                        />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                        {(Object.keys(FILTERS) as Filter[]).map(f => (
                            <button
                                key={f}
                                type="button"
                                onClick={() => setSearch({ filter: f === 'all' ? undefined : f })}
                                aria-pressed={filter === f}
                                className={cn(
                                    'px-3 py-1.5 rounded-full border text-sm font-semibold cursor-pointer transition-colors',
                                    filter === f ? 'bg-black text-white border-black' : 'border-line hover:bg-subtle',
                                )}
                            >
                                {FILTERS[f]}
                            </button>
                        ))}
                        {allTags.length > 0 && (
                            <select
                                value={search.tag ?? ''}
                                onChange={e => setSearch({ tag: e.target.value || undefined })}
                                className="px-3 py-1.5 rounded-full border border-line bg-surface text-sm font-semibold cursor-pointer"
                                aria-label="Filter by tag"
                            >
                                <option value="">Any tag</option>
                                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        )}
                    </div>
                </div>

                {rows.length === 0 ? (
                    <p className="rounded-xl border border-line p-8 text-center text-muted">No customers match.</p>
                ) : (
                    <>
                        {/* Phones: one card per customer, sorted the same way. */}
                        <ul className="md:hidden space-y-3">
                            {rows.map(c => (
                                <li key={c.id}>
                                    <Link
                                        to="/admin/customers/$userId"
                                        params={{ userId: c.id }}
                                        className="block rounded-xl border border-line bg-surface p-4 hover:bg-subtle"
                                    >
                                        <CustomerNameCell c={c} />
                                        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                            <div><dt className="text-muted">Trips</dt><dd className="font-semibold tabular-nums">{c.trips}</dd></div>
                                            <div><dt className="text-muted">Paid</dt><dd className="font-semibold tabular-nums">{money(c.lifetimePaid)}</dd></div>
                                            <div><dt className="text-muted">Next trip</dt><dd>{shortDate(c.nextTripStart) || '—'}</dd></div>
                                            <div><dt className="text-muted">Joined</dt><dd>{shortDate(c.createdAt) || '—'}</dd></div>
                                        </dl>
                                    </Link>
                                </li>
                            ))}
                        </ul>

                        <div className="hidden md:block overflow-x-auto rounded-xl border border-line bg-surface">
                            <table className="w-full text-sm">
                                <thead className="bg-subtle text-left">
                                    <tr>
                                        <SortHeader label="Customer" sortKey="name" sort={sort} desc={desc} onSort={toggleSort} />
                                        <th className="px-4 py-3 font-semibold">Phone</th>
                                        <th className="px-4 py-3 font-semibold">ID</th>
                                        <SortHeader label="Trips" sortKey="trips" sort={sort} desc={desc} onSort={toggleSort} align="right" />
                                        <SortHeader label="Lifetime paid" sortKey="paid" sort={sort} desc={desc} onSort={toggleSort} align="right" />
                                        <SortHeader label="Next trip" sortKey="next" sort={sort} desc={desc} onSort={toggleSort} />
                                        <SortHeader label="Last trip" sortKey="last" sort={sort} desc={desc} onSort={toggleSort} />
                                        <SortHeader label="Joined" sortKey="joined" sort={sort} desc={desc} onSort={toggleSort} />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {rows.map(c => (
                                        <tr key={c.id} className="hover:bg-subtle">
                                            <td className="px-4 py-3">
                                                <Link to="/admin/customers/$userId" params={{ userId: c.id }} className="block">
                                                    <CustomerNameCell c={c} />
                                                </Link>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">{c.phone ? formatPhone(c.phone) : <span className="text-muted">—</span>}</td>
                                            <td className="px-4 py-3">
                                                {c.identityVerified
                                                    ? <span className="inline-flex items-center gap-1 text-green-700 font-semibold"><Check size={14} aria-hidden />Verified</span>
                                                    : <span className="text-muted">No</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right tabular-nums">
                                                {c.trips}
                                                {c.canceled > 0 && <span className="text-muted"> (+{c.canceled} cancelled)</span>}
                                            </td>
                                            <td className="px-4 py-3 text-right tabular-nums">
                                                {money(c.lifetimePaid)}
                                                {c.owed > 0 && <div className="text-xs font-semibold text-red-700">owes {money(c.owed)}</div>}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">{shortDate(c.nextTripStart) || <span className="text-muted">—</span>}</td>
                                            <td className="px-4 py-3 whitespace-nowrap">{shortDate(c.lastTripEnd) || <span className="text-muted">—</span>}</td>
                                            <td className="px-4 py-3 whitespace-nowrap">{shortDate(c.createdAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

function sortValuePresent(c: CustomerListRow, sort: Sort): boolean {
    switch (sort) {
        case 'next': return c.nextTripStart !== null
        case 'last': return c.lastTripEnd !== null
        case 'joined': return c.createdAt !== null
        default: return true
    }
}

function CustomerNameCell({ c }: { c: CustomerListRow }) {
    return (
        <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-black">{c.name || c.email || 'Unnamed account'}</span>
                {c.isAdmin && <span className="rounded bg-black px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Admin</span>}
                {c.blockReason && <BlockedChip />}
                {c.tags.map(t => <TagChip key={t} tag={t} />)}
            </div>
            {c.name && c.email && <div className="text-muted truncate">{c.email}</div>}
        </div>
    )
}

function SortHeader({
    label, sortKey, sort, desc, onSort, align = 'left',
}: {
    label: string
    sortKey: Sort
    sort: Sort
    desc: boolean
    onSort: (s: Sort) => void
    align?: 'left' | 'right'
}) {
    const active = sort === sortKey
    return (
        <th className="px-4 py-3 font-semibold" aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}>
            <button
                type="button"
                onClick={() => onSort(sortKey)}
                className={cn('inline-flex items-center gap-1 cursor-pointer hover:underline', align === 'right' && 'ml-auto flex')}
            >
                {label}
                {active && (desc ? <ArrowDown size={14} aria-hidden /> : <ArrowUp size={14} aria-hidden />)}
            </button>
        </th>
    )
}
