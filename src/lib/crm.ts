// The customer CRM's server functions: /admin/customers and
// /admin/customers/$userId.
//
// Every function calls requireAdmin() first. The pages sit behind the /admin
// layout's check, but server functions can be called directly, and these read
// licence numbers and dates of birth (CLAUDE.md, "Auth & authorization").
//
// The rules live in blocks.server.ts, identity.server.ts and crm-summary.ts;
// these are thin wrappers. Never re-export a .server.ts function from here:
// pages import this file.

import { createServerFn } from '@tanstack/react-start'
import { getServiceRoleClient, requireAdmin } from './access.server'
import {
    blockCustomer as blockCustomerOnServer,
    checkLicenseAgainstBlocks,
    loadActiveBlocks,
    unblockCustomer as unblockCustomerOnServer,
} from './blocks.server'
import {
    identityImageLinks,
    recordVerifiedIdentity,
    stripeIdentityDashboardUrl,
    type IdentityImages,
} from './identity.server'
import { normalizeLicense, type BlockRow } from './blocks.ts'
import {
    MAX_NOTE_LENGTH,
    normalizeTags,
    summarizeCustomerMoney,
    type CustomerMoney,
    type MoneyCharge,
} from './crm-summary.ts'

// ── Types the pages use ──────────────────────────────────────────────────────

export type CustomerListRow = {
    id: string
    name: string | null
    email: string | null
    phone: string | null
    city: string | null
    state: string | null
    createdAt: string | null
    identityVerified: boolean
    isAdmin: boolean
    /** Confirmed or completed trips. */
    trips: number
    canceled: number
    /** Start of the next confirmed trip that hasn't ended. */
    nextTripStart: string | null
    lastTripEnd: string | null
    lifetimePaid: number
    owed: number
    tags: string[]
    blockReason: string | null
    licenseExpires: string | null
}

export type CustomerIdentity = {
    verificationSessionId: string
    livemode: boolean
    verifiedAt: string | null
    firstName: string | null
    lastName: string | null
    dob: string | null
    licenseNumber: string | null
    documentType: string | null
    issuingCountry: string | null
    issuingState: string | null
    issuedDate: string | null
    expirationDate: string | null
    address: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null } | null
    sensitiveCaptured: boolean
    dashboardUrl: string
    /** Other accounts verified with the same licence number. */
    sameLicense: { id: string; name: string | null; email: string | null }[]
}

export type CustomerTrip = {
    id: string
    status: string
    start_time: string
    end_time: string
    created_at: string
    total_price: number
    refunded_amount: number | null
    canceled_by: string | null
    pickup_location: string | null
    cars: { id: number; make: string; model: string; year: number } | null
}

export type CustomerNote = { id: string; body: string; createdAt: string; authorName: string | null }

export type CustomerBlock = BlockRow & {
    blockedByName: string | null
    liftedByName: string | null
    /** Set when the block is on another account, reaching this one through the licence. */
    viaAccount: { id: string; name: string | null } | null
}

export type CustomerDetail = {
    profile: {
        id: string
        fullName: string | null
        email: string | null
        phone: string | null
        dateOfBirth: string | null
        address: string | null
        city: string | null
        state: string | null
        zip: string | null
        createdAt: string | null
        identityVerified: boolean
        identityVerifiedAt: string | null
        hasIdentitySession: boolean
        isAdmin: boolean
        stripeCustomerUrl: string | null
    }
    identity: CustomerIdentity | null
    trips: CustomerTrip[]
    money: CustomerMoney
    reviews: { id: string; rating: number; body: string; createdAt: string; removedAt: string | null; car: string | null }[]
    notes: CustomerNote[]
    tags: string[]
    knownTags: string[]
    activeBlocks: CustomerBlock[]
    blockHistory: CustomerBlock[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const stripeLive = () => (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live')
const stripeDashboard = (path: string) => `https://dashboard.stripe.com/${stripeLive() ? '' : 'test/'}${path}`

type Admin = ReturnType<typeof getServiceRoleClient>

async function namesFor(admin: Admin, ids: (string | null | undefined)[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
    if (unique.length === 0) return new Map()
    const { data } = await admin.from('profiles').select('id, full_name, email').in('id', unique)
    return new Map((data ?? []).map(p => [p.id, p.full_name || p.email]))
}

async function assertCustomerExists(admin: Admin, userId: string) {
    const { data } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle()
    if (!data) throw new Error('Customer not found')
}

// ── The list ─────────────────────────────────────────────────────────────────

/**
 * Every account, with what the list page sorts and filters on. Loads
 * everything at once, which is fine for hundreds or a few thousand customers.
 * Past that, move the search and paging into the query.
 */
export const listCustomers = createServerFn({ method: 'GET' }).handler(async (): Promise<CustomerListRow[]> => {
    await requireAdmin()
    const admin = getServiceRoleClient()

    const [profiles, bookings, charges, tags, blocks, identities] = await Promise.all([
        admin.from('profiles').select('id, full_name, email, phone, city, state, created_at, identity_verified, is_admin'),
        admin.from('bookings')
            .select('id, user_id, status, start_time, end_time, total_price, refunded_amount')
            .in('status', ['confirmed', 'completed', 'canceled']),
        admin.from('booking_charges').select('booking_id, kind, status, amount, tax_amount, amount_captured, amount_refunded'),
        admin.from('customer_tags').select('user_id, tag').order('created_at', { ascending: true }),
        admin.from('customer_blocks').select('*').is('lifted_at', null),
        admin.from('customer_identities').select('user_id, license_number, expiration_date'),
    ])
    for (const r of [profiles, bookings, charges, tags, blocks, identities]) {
        if (r.error) throw new Error(r.error.message)
    }

    const now = new Date()
    const bookingsByUser = new Map<string, any[]>()
    for (const b of bookings.data ?? []) {
        if (!b.user_id) continue
        const list = bookingsByUser.get(b.user_id) ?? []
        list.push(b)
        bookingsByUser.set(b.user_id, list)
    }
    const userOfBooking = new Map((bookings.data ?? []).map(b => [b.id, b.user_id]))
    const chargesByUser = new Map<string, MoneyCharge[]>()
    for (const c of (charges.data ?? []) as MoneyCharge[]) {
        const uid = userOfBooking.get(c.booking_id)
        if (!uid) continue
        const list = chargesByUser.get(uid) ?? []
        list.push(c)
        chargesByUser.set(uid, list)
    }
    const tagsByUser = new Map<string, string[]>()
    for (const t of tags.data ?? []) tagsByUser.set(t.user_id, [...(tagsByUser.get(t.user_id) ?? []), t.tag])
    const identityByUser = new Map((identities.data ?? []).map(i => [i.user_id, i]))
    const activeBlocks = (blocks.data ?? []) as BlockRow[]
    const blockByUser = new Map(activeBlocks.filter(b => b.user_id).map(b => [b.user_id!, b]))
    const blockByLicense = new Map(activeBlocks.filter(b => b.license_number).map(b => [b.license_number!, b]))

    return (profiles.data ?? []).map(p => {
        const own = bookingsByUser.get(p.id) ?? []
        const live = own.filter(b => b.status === 'confirmed' || b.status === 'completed')
        const upcoming = live
            .filter(b => b.status === 'confirmed' && new Date(b.end_time) > now)
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
        const ended = live
            .filter(b => new Date(b.end_time) <= now)
            .sort((a, b) => b.end_time.localeCompare(a.end_time))
        const money = summarizeCustomerMoney(own, chargesByUser.get(p.id) ?? [])
        const identity = identityByUser.get(p.id)
        const license = normalizeLicense(identity?.license_number)
        const block = blockByUser.get(p.id) ?? (license ? blockByLicense.get(license) : undefined) ?? null
        return {
            id: p.id,
            name: p.full_name,
            email: p.email,
            phone: p.phone || null,
            city: p.city,
            state: p.state,
            createdAt: p.created_at,
            identityVerified: Boolean(p.identity_verified),
            isAdmin: Boolean(p.is_admin),
            trips: live.length,
            canceled: own.filter(b => b.status === 'canceled').length,
            nextTripStart: upcoming[0]?.start_time ?? null,
            lastTripEnd: ended[0]?.end_time ?? null,
            lifetimePaid: money.lifetimePaid,
            owed: money.owed,
            tags: tagsByUser.get(p.id) ?? [],
            blockReason: block?.reason ?? null,
            licenseExpires: identity?.expiration_date ?? null,
        }
    })
})

// ── One customer ─────────────────────────────────────────────────────────────

export const getCustomer = createServerFn({ method: 'GET' })
    .inputValidator((userId: string) => userId)
    .handler(async ({ data: userId }): Promise<CustomerDetail> => {
        await requireAdmin()
        const admin = getServiceRoleClient()

        const { data: p, error } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle()
        if (error) throw new Error(error.message)
        if (!p) throw new Error('Customer not found')

        const [identityRes, tripsRes, reviewsRes, notesRes, tagsRes, allTagsRes, historyRes] = await Promise.all([
            admin.from('customer_identities').select('*').eq('user_id', userId).maybeSingle(),
            admin.from('bookings')
                .select('id, status, start_time, end_time, created_at, total_price, refunded_amount, canceled_by, pickup_location, cars(id, make, model, year)')
                .eq('user_id', userId)
                .order('start_time', { ascending: false }),
            admin.from('reviews').select('id, rating, body, created_at, removed_at, cars(make, model, year)').eq('user_id', userId)
                .order('created_at', { ascending: false }),
            admin.from('customer_notes').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
            admin.from('customer_tags').select('tag').eq('user_id', userId).order('created_at', { ascending: true }),
            admin.from('customer_tags').select('tag'),
            admin.from('customer_blocks').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        ])

        const trips = (tripsRes.data ?? []) as unknown as CustomerTrip[]
        const bookingIds = trips.map(t => t.id)
        const { data: charges } = bookingIds.length
            ? await admin.from('booking_charges')
                .select('booking_id, kind, status, amount, tax_amount, amount_captured, amount_refunded')
                .in('booking_id', bookingIds)
            : { data: [] }

        const identityRow = identityRes.data
        const license = normalizeLicense(identityRow?.license_number)
        const active = await loadActiveBlocks(admin, userId, license)

        let sameLicense: CustomerIdentity['sameLicense'] = []
        if (license) {
            const { data: others } = await admin
                .from('customer_identities').select('user_id').eq('license_number', license).neq('user_id', userId)
            const otherIds = (others ?? []).map(o => o.user_id)
            const { data: otherProfiles } = otherIds.length
                ? await admin.from('profiles').select('id, full_name, email').in('id', otherIds)
                : { data: [] }
            sameLicense = (otherProfiles ?? []).map(o => ({ id: o.id, name: o.full_name, email: o.email }))
        }

        const history = (historyRes.data ?? []) as BlockRow[]
        const allBlocks = [...active, ...history.filter(h => !active.some(a => a.id === h.id))]
        const names = await namesFor(admin, [
            ...allBlocks.flatMap(b => [b.blocked_by, b.lifted_by, b.user_id]),
            ...(notesRes.data ?? []).map(n => n.author_id),
        ])
        const decorate = (b: BlockRow): CustomerBlock => ({
            ...b,
            blockedByName: b.blocked_by ? names.get(b.blocked_by) ?? null : null,
            liftedByName: b.lifted_by ? names.get(b.lifted_by) ?? null : null,
            viaAccount: b.user_id && b.user_id !== userId ? { id: b.user_id, name: names.get(b.user_id) ?? null } : null,
        })

        const carName = (c: any) => (c ? `${c.make} ${c.model} ${c.year}` : null)

        return {
            profile: {
                id: p.id,
                fullName: p.full_name,
                email: p.email,
                phone: p.phone || null,
                dateOfBirth: p.date_of_birth,
                address: p.address,
                city: p.city,
                state: p.state,
                zip: p.zip,
                createdAt: p.created_at,
                identityVerified: Boolean(p.identity_verified),
                identityVerifiedAt: p.identity_verified_at,
                hasIdentitySession: Boolean(p.stripe_identity_session_id),
                isAdmin: Boolean(p.is_admin),
                stripeCustomerUrl: p.stripe_customer_id ? stripeDashboard(`customers/${p.stripe_customer_id}`) : null,
            },
            identity: identityRow
                ? {
                    verificationSessionId: identityRow.verification_session_id,
                    livemode: identityRow.livemode,
                    verifiedAt: identityRow.verified_at,
                    firstName: identityRow.first_name,
                    lastName: identityRow.last_name,
                    dob: identityRow.dob,
                    licenseNumber: identityRow.license_number,
                    documentType: identityRow.document_type,
                    issuingCountry: identityRow.issuing_country,
                    issuingState: identityRow.issuing_state,
                    issuedDate: identityRow.issued_date,
                    expirationDate: identityRow.expiration_date,
                    address: identityRow.address as CustomerIdentity['address'],
                    sensitiveCaptured: identityRow.sensitive_captured,
                    dashboardUrl: stripeIdentityDashboardUrl(identityRow.verification_session_id, identityRow.livemode),
                    sameLicense,
                }
                : null,
            trips,
            money: summarizeCustomerMoney(trips, (charges ?? []) as MoneyCharge[]),
            reviews: (reviewsRes.data ?? []).map((r: any) => ({
                id: r.id, rating: r.rating, body: r.body, createdAt: r.created_at, removedAt: r.removed_at, car: carName(r.cars),
            })),
            notes: (notesRes.data ?? []).map(n => ({
                id: n.id, body: n.body, createdAt: n.created_at, authorName: n.author_id ? names.get(n.author_id) ?? null : null,
            })),
            tags: (tagsRes.data ?? []).map(t => t.tag),
            knownTags: [...new Set((allTagsRes.data ?? []).map(t => t.tag))].sort((a, b) => a.localeCompare(b)),
            activeBlocks: active.map(decorate),
            blockHistory: history.filter(h => h.lifted_at).map(decorate),
        }
    })

/**
 * Tags and block state for a set of guests, for the trip lists and the
 * reservation page. Only what a chip needs.
 */
export const getCustomerFlags = createServerFn({ method: 'POST' })
    .inputValidator((userIds: string[]) => userIds.slice(0, 1000))
    .handler(async ({ data: userIds }): Promise<Record<string, { tags: string[]; blocked: boolean }>> => {
        await requireAdmin()
        const ids = [...new Set(userIds.filter(Boolean))]
        if (ids.length === 0) return {}
        const admin = getServiceRoleClient()
        const [tags, identities] = await Promise.all([
            admin.from('customer_tags').select('user_id, tag').in('user_id', ids).order('created_at', { ascending: true }),
            admin.from('customer_identities').select('user_id, license_number').in('user_id', ids),
        ])
        const licenses = (identities.data ?? []).map(i => normalizeLicense(i.license_number)).filter((l): l is string => Boolean(l))
        const [byUser, byLicense] = await Promise.all([
            admin.from('customer_blocks').select('user_id').is('lifted_at', null).in('user_id', ids),
            licenses.length
                ? admin.from('customer_blocks').select('license_number').is('lifted_at', null).in('license_number', licenses)
                : Promise.resolve({ data: [] as { license_number: string | null }[] }),
        ])
        const blockedUsers = new Set((byUser.data ?? []).map(b => b.user_id))
        const blockedLicenses = new Set((byLicense.data ?? []).map(b => b.license_number))
        const licenseOf = new Map((identities.data ?? []).map(i => [i.user_id, normalizeLicense(i.license_number)]))

        const out: Record<string, { tags: string[]; blocked: boolean }> = {}
        for (const id of ids) {
            const lic = licenseOf.get(id)
            out[id] = {
                tags: (tags.data ?? []).filter(t => t.user_id === id).map(t => t.tag),
                blocked: blockedUsers.has(id) || Boolean(lic && blockedLicenses.has(lic)),
            }
        }
        return out
    })

// ── Notes and tags ───────────────────────────────────────────────────────────

export const addCustomerNote = createServerFn({ method: 'POST' })
    .inputValidator((input: { userId: string; body: string }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        const body = data.body.trim()
        if (!body) throw new Error('Write something first.')
        if (body.length > MAX_NOTE_LENGTH) throw new Error(`Keep notes under ${MAX_NOTE_LENGTH} characters.`)
        const admin = getServiceRoleClient()
        await assertCustomerExists(admin, data.userId)
        const { error } = await admin.from('customer_notes').insert({ user_id: data.userId, body, author_id: user.id })
        if (error) throw new Error(error.message)
        return { ok: true as const }
    })

export const deleteCustomerNote = createServerFn({ method: 'POST' })
    .inputValidator((noteId: string) => noteId)
    .handler(async ({ data: noteId }) => {
        await requireAdmin()
        const { error } = await getServiceRoleClient().from('customer_notes').delete().eq('id', noteId)
        if (error) throw new Error(error.message)
        return { ok: true as const }
    })

/** Replaces the customer's tags with exactly these. */
export const setCustomerTags = createServerFn({ method: 'POST' })
    .inputValidator((input: { userId: string; tags: string[] }) => input)
    .handler(async ({ data }) => {
        await requireAdmin()
        const tags = normalizeTags(data.tags)
        const admin = getServiceRoleClient()
        await assertCustomerExists(admin, data.userId)

        const { data: current } = await admin.from('customer_tags').select('tag').eq('user_id', data.userId)
        const have = new Set((current ?? []).map(t => t.tag))
        const want = new Set(tags)
        const remove = [...have].filter(t => !want.has(t))
        const add = tags.filter(t => !have.has(t))

        if (remove.length) {
            const { error } = await admin.from('customer_tags').delete().eq('user_id', data.userId).in('tag', remove)
            if (error) throw new Error(error.message)
        }
        if (add.length) {
            const { error } = await admin.from('customer_tags').insert(add.map(tag => ({ user_id: data.userId, tag })))
            // Two tabs adding the same tag: the primary key already holds it.
            if (error && error.code !== '23505') throw new Error(error.message)
        }
        return { tags }
    })

// ── Blocking ─────────────────────────────────────────────────────────────────

export const blockCustomer = createServerFn({ method: 'POST' })
    .inputValidator((input: { userId: string; reason: string; licenseNumber?: string }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        return blockCustomerOnServer(getServiceRoleClient(), {
            userId: data.userId,
            reason: data.reason,
            licenseNumber: data.licenseNumber,
            blockedBy: user.id,
        })
    })

export const unblockCustomer = createServerFn({ method: 'POST' })
    .inputValidator((input: { userId: string; reason: string }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        return unblockCustomerOnServer(getServiceRoleClient(), { userId: data.userId, reason: data.reason, liftedBy: user.id })
    })

// ── The licence ──────────────────────────────────────────────────────────────

/** The licence photos and selfie, as 30-second links. Inside 48 hours of verification only. */
export const getCustomerIdentityImages = createServerFn({ method: 'POST' })
    .inputValidator((userId: string) => userId)
    .handler(async ({ data: userId }): Promise<IdentityImages> => {
        await requireAdmin()
        const { data } = await getServiceRoleClient()
            .from('customer_identities').select('verification_session_id').eq('user_id', userId).maybeSingle()
        if (!data) return { available: false, reason: 'No verification on record.' }
        return identityImageLinks(data.verification_session_id)
    })

/**
 * Reads the customer's verification from Stripe again. Fills in the record
 * for a guest verified before the CRM existed. Their licence number, date of
 * birth and expiry only come back inside the 48 hours.
 */
export const refreshCustomerIdentity = createServerFn({ method: 'POST' })
    .inputValidator((userId: string) => userId)
    .handler(async ({ data: userId }) => {
        await requireAdmin()
        const admin = getServiceRoleClient()
        const { data: p } = await admin
            .from('profiles').select('stripe_identity_session_id').eq('id', userId).maybeSingle()
        const sessionId = p?.stripe_identity_session_id
        if (!sessionId) throw new Error('This customer has never started ID verification.')
        const result = await recordVerifiedIdentity(admin, sessionId)
        if (!result) throw new Error('Their verification has not succeeded, so there is nothing to record.')
        return result
    })

/**
 * An owner typing the licence number in, copied from the Stripe Dashboard,
 * for a guest whose 48 hours had passed. It's then checked against the
 * blocklist like a verified one, and a note records who entered it.
 */
export const setCustomerLicenseNumber = createServerFn({ method: 'POST' })
    .inputValidator((input: { userId: string; licenseNumber: string }) => input)
    .handler(async ({ data }) => {
        const { user } = await requireAdmin()
        const license = normalizeLicense(data.licenseNumber)
        if (!license || license.length < 4 || license.length > 25) {
            throw new Error('That doesn\'t look like a licence number.')
        }
        const admin = getServiceRoleClient()
        const { data: p } = await admin
            .from('profiles').select('stripe_identity_session_id').eq('id', data.userId).maybeSingle()
        if (!p) throw new Error('Customer not found')

        const { data: existing } = await admin
            .from('customer_identities').select('user_id').eq('user_id', data.userId).maybeSingle()
        const write = existing
            ? admin.from('customer_identities')
                .update({ license_number: license, updated_at: new Date().toISOString() })
                .eq('user_id', data.userId)
            : admin.from('customer_identities').insert({
                user_id: data.userId,
                verification_session_id: p.stripe_identity_session_id || 'manual',
                livemode: stripeLive(),
                license_number: license,
            })
        const { error } = await write
        if (error) throw new Error(error.message)

        await admin.from('customer_notes').insert({
            user_id: data.userId,
            author_id: user.id,
            body: 'Licence number entered by hand (copied from the Stripe Dashboard).',
        })

        // A block already on this account gains the licence, unless another
        // block already carries it (one active block per licence).
        const { data: ownBlock } = await admin
            .from('customer_blocks').select('id, license_number').eq('user_id', data.userId).is('lifted_at', null).maybeSingle()
        if (ownBlock && !ownBlock.license_number) {
            const { error: lerr } = await admin.from('customer_blocks').update({ license_number: license }).eq('id', ownBlock.id)
            if (lerr && lerr.code !== '23505') throw new Error(lerr.message)
        }

        const blocked = await checkLicenseAgainstBlocks(admin, data.userId, license)
        return { blocked }
    })
