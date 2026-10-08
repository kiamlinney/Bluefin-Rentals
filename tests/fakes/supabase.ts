// An in-memory stand-in for the Supabase client, for testing server code.
//
// It implements the slice of the PostgREST query builder this codebase uses
// (select/insert/update/upsert/delete, eq/neq/in/is/not/gt/gte/lt/lte/or,
// order/limit, single/maybeSingle, embedded relations) and — on purpose — the
// database rules that the code relies on to be safe:
//
//   - the partial unique indexes (one deposit attempt in flight, one open
//     extension, one live extra per trip), which return Postgres's 23505;
//   - the bookings status trigger, as written in
//     supabase/migrations/20261007120000_prelaunch_hardening.sql.
//
// RLS is not modelled: every server path under test uses the service-role
// client, and the RLS policies are checked against the live database in the
// audit instead (ImportantFiles/pre-launch-audit.md).

import { randomUUID } from 'node:crypto'

export type Row = Record<string, any>
type Tables = Record<string, Row[]>
type Result = { data: any; error: { message: string; code?: string } | null; count?: number | null }

// How an embed like `cars(...)` or `bookings!inner(...)` on a table finds its row.
const RELATIONS: Record<string, Record<string, { local: string; foreign: string; many?: boolean }>> = {
    bookings: {
        cars: { local: 'car_id', foreign: 'id' },
        profiles: { local: 'user_id', foreign: 'id' },
        trip_media: { local: 'id', foreign: 'booking_id', many: true },
    },
    booking_charges: { bookings: { local: 'booking_id', foreign: 'id' } },
    booking_extensions: { bookings: { local: 'booking_id', foreign: 'id' } },
    booking_extras: { bookings: { local: 'booking_id', foreign: 'id' } },
    reviews: { cars: { local: 'car_id', foreign: 'id' } },
}

const DEFAULTS: Record<string, () => Row> = {
    booking_charges: () => ({
        category: null, tax_amount: 0, tax_lines: [], line_items: [], amount_captured: 0, amount_refunded: 0,
        status: 'requires_payment', stripe_payment_intent_id: null, payment_method_id: null, failure_message: null,
        capture_before: null, keep_holding: false, renews_charge_id: null, refund_id: null,
        receipt_sent_at: null, action_email_sent_at: null, created_by: null, settled_at: null,
    }),
    booking_extensions: () => ({ status: 'pending', charge_id: null, decided_at: null, decided_by: null }),
    booking_extras: () => ({ status: 'approved', charged: false, charge_id: null, decided_at: null }),
    bookings: () => ({
        status: 'pending', refund_id: null, refunded_amount: null, canceled_at: null, canceled_by: null,
        cancellation_reason: null, cancel_notified_at: null, admin_notified_at: null, guest_notified_at: null,
        payment_method_id: null, deposit_waived_at: null, deposit_waived_by: null, price_quote: null,
        miles_driven: null, pickup_location: 'Home base', booking_rate: 'non-refundable',
    }),
}

type Unique = { table: string; name: string; key: (r: Row) => string | null }
const UNIQUES: Unique[] = [
    {
        table: 'booking_charges',
        name: 'booking_charges_one_deposit_in_flight',
        key: r => (r.kind === 'deposit' && ['requires_payment', 'processing'].includes(r.status) ? r.booking_id : null),
    },
    {
        table: 'booking_extensions',
        name: 'booking_extensions_one_open',
        key: r => (['pending', 'requested'].includes(r.status) ? r.booking_id : null),
    },
    {
        table: 'booking_extras',
        name: 'booking_extras_one_per_trip_idx',
        key: r => (r.status !== 'declined' ? `${r.booking_id}:${r.extra_id}` : null),
    },
    { table: 'booking_charges', name: 'booking_charges_stripe_payment_intent_id_key', key: r => r.stripe_payment_intent_id ?? null },
]

/** The bookings status trigger, mirrored from the 2026-10-07 migration. */
function bookingTransitionAllowed(old: Row, next: Row): boolean {
    if (old.status === next.status) return true
    const [from, to] = [old.status, next.status]
    return (
        (from === 'pending' && ['confirmed', 'expired', 'canceled', 'failed'].includes(to)) ||
        (from === 'expired' && ['confirmed', 'canceled'].includes(to)) ||
        (from === 'failed' && ['confirmed', 'canceled'].includes(to)) ||
        (from === 'confirmed' && ['canceled', 'completed'].includes(to)) ||
        (from === 'canceled' && to === 'confirmed' && old.refund_id == null && next.refund_id == null)
    )
}

const CANCELED_BY = new Set([null, undefined, 'guest', 'admin', 'system'])

// ── Value comparison ────────────────────────────────────────────────────────

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/
function cmp(a: any, b: any): number {
    if (a == null || b == null) return a == null && b == null ? 0 : NaN
    if (typeof a === 'string' && typeof b === 'string' && TIMESTAMP.test(a) && TIMESTAMP.test(b)) {
        return new Date(a).getTime() - new Date(b).getTime()
    }
    const na = Number(a), nb = Number(b)
    if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'boolean') return na - nb
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}
const eq = (a: any, b: any) => (typeof a === 'boolean' || typeof b === 'boolean' ? String(a) === String(b) : cmp(a, b) === 0)

function get(row: Row, path: string): any {
    return path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), row as any)
}

type Pred = (row: Row) => boolean

function opPred(col: string, op: string, value: string): Pred {
    switch (op) {
        case 'eq': return r => eq(get(r, col), value)
        case 'neq': return r => !eq(get(r, col), value)
        case 'gt': return r => cmp(get(r, col), value) > 0
        case 'gte': return r => cmp(get(r, col), value) >= 0
        case 'lt': return r => cmp(get(r, col), value) < 0
        case 'lte': return r => cmp(get(r, col), value) <= 0
        case 'is': return r => (value === 'null' ? get(r, col) == null : String(get(r, col)) === value)
        case 'in': {
            const list = value.replace(/^\(|\)$/g, '').split(',')
            return r => list.some(v => eq(get(r, col), v))
        }
        default: throw new Error(`fake supabase: unsupported or() operator "${op}"`)
    }
}

// PostgREST's or() syntax: `a.eq.1,and(b.gte.X,c.neq.Y)`.
function splitTopLevel(s: string): string[] {
    const parts: string[] = []
    let depth = 0, start = 0
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '(') depth++
        else if (s[i] === ')') depth--
        else if (s[i] === ',' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1 }
    }
    parts.push(s.slice(start))
    return parts.map(p => p.trim()).filter(Boolean)
}
function parseOr(expr: string): Pred {
    const terms = splitTopLevel(expr).map(parseTerm)
    return r => terms.some(t => t(r))
}
function parseTerm(term: string): Pred {
    if (term.startsWith('and(')) {
        const inner = splitTopLevel(term.slice(4, -1)).map(parseTerm)
        return r => inner.every(t => t(r))
    }
    if (term.startsWith('or(')) return parseOr(term.slice(3, -1))
    const first = term.indexOf('.')
    const second = term.indexOf('.', first + 1)
    return opPred(term.slice(0, first), term.slice(first + 1, second), term.slice(second + 1))
}

// Embeds in a select string: `*, cars(*), profiles(full_name), bookings!inner(status)`.
function parseEmbeds(select: string): { name: string; inner: boolean; count: boolean }[] {
    const embeds: { name: string; inner: boolean; count: boolean }[] = []
    for (const part of splitTopLevel(select)) {
        const m = part.match(/^(?:\w+:)?(\w+)(!inner)?(?::\w+)?\((.*)\)$/s)
        if (m) embeds.push({ name: m[1], inner: Boolean(m[2]), count: m[3].trim() === 'count' })
    }
    return embeds
}

// ── The query builder ────────────────────────────────────────────────────────

class Query implements PromiseLike<Result> {
    private filters: Pred[] = []
    private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
    private payload: any = null
    private selectStr: string | null = null
    private wantsRows = false
    private mode: 'many' | 'single' | 'maybe' = 'many'
    private orders: { col: string; asc: boolean }[] = []
    private limitN: number | null = null
    private headCount = false

    constructor(private db: FakeDb, private table: string) {}

    select(cols = '*', opts?: { count?: string; head?: boolean }) {
        if (this.op === 'select') this.selectStr = cols
        else this.wantsRows = true
        this.selectStr = cols
        if (opts?.head) this.headCount = true
        return this
    }
    insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = rows; return this }
    upsert(rows: Row | Row[]) { this.op = 'upsert'; this.payload = rows; return this }
    update(patch: Row) { this.op = 'update'; this.payload = patch; return this }
    delete() { this.op = 'delete'; return this }

    eq(col: string, v: any) { this.filters.push(r => eq(get(r, col), v)); return this }
    neq(col: string, v: any) { this.filters.push(r => !eq(get(r, col), v)); return this }
    gt(col: string, v: any) { this.filters.push(r => cmp(get(r, col), v) > 0); return this }
    gte(col: string, v: any) { this.filters.push(r => cmp(get(r, col), v) >= 0); return this }
    lt(col: string, v: any) { this.filters.push(r => cmp(get(r, col), v) < 0); return this }
    lte(col: string, v: any) { this.filters.push(r => cmp(get(r, col), v) <= 0); return this }
    in(col: string, vs: any[]) { this.filters.push(r => vs.some(v => eq(get(r, col), v))); return this }
    is(col: string, v: null | boolean) { this.filters.push(r => (v === null ? get(r, col) == null : get(r, col) === v)); return this }
    not(col: string, op: string, v: any) {
        if (op === 'is' && v === null) this.filters.push(r => get(r, col) != null)
        else { const p = opPred(col, op, String(v)); this.filters.push(r => !p(r)) }
        return this
    }
    or(expr: string) { this.filters.push(parseOr(expr)); return this }
    order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this }
    limit(n: number) { this.limitN = n; return this }
    single() { this.mode = 'single'; return this }
    maybeSingle() { this.mode = 'maybe'; return this }

    then<A, B>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: any) => B | PromiseLike<B>) | null) {
        return Promise.resolve().then(() => this.run()).then(ok, fail)
    }

    /** A copy of the row with its embeds attached, or null if an !inner embed is missing. */
    private embedOne(row: Row): Row | null {
        const copy: Row = { ...row }
        if (!this.selectStr) return copy
        for (const e of parseEmbeds(this.selectStr)) {
            const rel = RELATIONS[this.table]?.[e.name]
            if (!rel) continue
            const related = this.db.rows(e.name).filter(o => eq(o[rel.foreign], row[rel.local]))
            if (e.count) copy[e.name] = [{ count: related.length }]
            else if (rel.many) copy[e.name] = related.map(r => ({ ...r }))
            else {
                copy[e.name] = related[0] ? { ...related[0] } : null
                if (e.inner && !related[0]) return null
            }
        }
        return copy
    }

    private embedded(rows: Row[]): Row[] {
        return rows.map(r => this.embedOne(r)).filter((r): r is Row => r !== null)
    }

    private matching(): Row[] {
        // Filters may reference embedded columns (`bookings.car_id`), so they run
        // over the embedded copy; the stored row is what gets written.
        return this.db.rows(this.table).filter(row => {
            const view = this.embedOne(row)
            return view !== null && this.filters.every(f => f(view))
        })
    }

    private finish(rows: Row[]): Result {
        if (this.headCount) return { data: null, error: null, count: rows.length }
        if (this.mode === 'single') {
            if (rows.length !== 1) return { data: null, error: { message: `expected 1 row, got ${rows.length}`, code: 'PGRST116' } }
            return { data: rows[0], error: null }
        }
        if (this.mode === 'maybe') {
            if (rows.length > 1) return { data: null, error: { message: 'multiple rows', code: 'PGRST116' } }
            return { data: rows[0] ?? null, error: null }
        }
        return { data: rows, error: null }
    }

    private run(): Result {
        const db = this.db
        db.log.push({ table: this.table, op: this.op })
        if (this.op === 'select') {
            const stored = db.rows(this.table)
            let view = this.embedded(stored).filter(r => this.filters.every(f => f(r)))
            for (const o of [...this.orders].reverse()) {
                view = [...view].sort((a, b) => (o.asc ? 1 : -1) * (cmp(get(a, o.col), get(b, o.col)) || 0))
            }
            if (this.limitN != null) view = view.slice(0, this.limitN)
            return this.finish(view)
        }

        if (this.op === 'insert' || this.op === 'upsert') {
            const list = Array.isArray(this.payload) ? this.payload : [this.payload]
            const inserted: Row[] = []
            for (const raw of list) {
                if (this.op === 'upsert' && raw.id) {
                    const existing = db.rows(this.table).find(r => r.id === raw.id)
                    if (existing) { Object.assign(existing, raw); inserted.push(existing); continue }
                }
                const row: Row = {
                    id: randomUUID(),
                    created_at: db.now().toISOString(),
                    ...(DEFAULTS[this.table]?.() ?? {}),
                    ...raw,
                }
                const violation = db.checkWrite(this.table, null, row)
                if (violation) return { data: null, error: violation }
                db.rows(this.table).push(row)
                inserted.push(row)
            }
            if (!this.wantsRows) return { data: null, error: null }
            return this.finish(this.embedded(inserted))
        }

        if (this.op === 'update') {
            const targets = this.matching()
            for (const row of targets) {
                const next = { ...row, ...this.payload }
                const violation = db.checkWrite(this.table, row, next)
                if (violation) return { data: null, error: violation }
            }
            for (const row of targets) Object.assign(row, this.payload)
            if (!this.wantsRows) return { data: null, error: null }
            return this.finish(this.embedded(targets))
        }

        // delete
        const targets = new Set(this.matching())
        db.tables[this.table] = db.rows(this.table).filter(r => !targets.has(r))
        if (!this.wantsRows) return { data: null, error: null }
        return this.finish([...targets])
    }
}

export class FakeDb {
    tables: Tables = {}
    log: { table: string; op: string }[] = []
    /** The signed-in user the cookie client reports, or null. */
    user: { id: string; email?: string } | null = null

    constructor(seed: Tables = {}, readonly now: () => Date = () => new Date()) {
        for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map(r => ({ ...r }))
    }

    rows(table: string): Row[] {
        return (this.tables[table] ??= [])
    }

    find(table: string, id: string): Row | undefined {
        return this.rows(table).find(r => r.id === id)
    }

    insert(table: string, row: Row): Row {
        const full = { id: randomUUID(), created_at: this.now().toISOString(), ...(DEFAULTS[table]?.() ?? {}), ...row }
        this.rows(table).push(full)
        return full
    }

    checkWrite(table: string, old: Row | null, next: Row): { message: string; code: string } | null {
        for (const u of UNIQUES.filter(u => u.table === table)) {
            const key = u.key(next)
            if (key == null) continue
            const clash = this.rows(table).some(r => r !== old && u.key(r) === key)
            if (clash) return { message: `duplicate key value violates unique constraint "${u.name}"`, code: '23505' }
        }
        if (table === 'bookings') {
            if (!CANCELED_BY.has(next.canceled_by)) {
                return { message: 'violates check constraint "bookings_canceled_by_chk"', code: '23514' }
            }
            if (next.refunded_amount != null && Number(next.refunded_amount) > Number(next.total_price) + 0.001) {
                return { message: 'violates check constraint "bookings_refunded_amount_chk"', code: '23514' }
            }
            if (old && !bookingTransitionAllowed(old, next)) {
                return { message: `Illegal status transition: ${old.status} -> ${next.status}`, code: 'P0001' }
            }
        }
        return null
    }

    from(table: string) {
        return new Query(this, table)
    }

    rpc(name: string, args: Row = {}): Promise<Result> {
        // As defined in the live database: confirmed bookings only.
        if (name === 'get_car_unavailability') {
            const rows = this.rows('bookings')
                .filter(b => eq(b.car_id, args.car_id_param) && b.status === 'confirmed')
                .map(b => ({ start_time: b.start_time, end_time: b.end_time }))
            return Promise.resolve({ data: rows, error: null })
        }
        return Promise.resolve({ data: null, error: { message: `fake supabase: rpc ${name} not implemented` } })
    }

    get auth() {
        return {
            getUser: async () => ({ data: { user: this.user }, error: null }),
        }
    }

    get storage() {
        return { from: () => ({}) }
    }
}
