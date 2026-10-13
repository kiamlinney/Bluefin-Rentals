// Blocking customers: the server half of src/lib/blocks.ts.
//
// A block stops new activity, not sign-in. A blocked guest can still open
// their trips and receipts and pay what they owe (a damage charge's pay link
// has to keep working), so assertNotBlocked is called only where something new
// starts: checkout, ID verification, a guest's extension, a guest's extras
// request, a review. Never on a confirmation path, a pay link or a trip page.
//
// Blocking never cancels a confirmed trip by itself. It does close every
// checkout the guest could still pay (releaseOpenCheckouts), because a checkout
// tab opened before the block would otherwise still take the money.
//
// Server-only (.server.ts), for the same bundling reason as access.server.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripe } from './payments.server'
import { sendAdminAlert } from './charge-email'
import {
    activeBlocksFor,
    BLOCKED_MESSAGE,
    MAX_BLOCK_REASON,
    normalizeLicense,
    type BlockRow,
} from './blocks.ts'

type AdminClient = SupabaseClient<any, any, any>

/** Thrown by assertNotBlocked. The message is the one the guest sees. */
export class CustomerBlockedError extends Error {
    constructor() {
        super(BLOCKED_MESSAGE)
        this.name = 'CustomerBlockedError'
    }
}

async function storedLicense(admin: AdminClient, userId: string): Promise<string | null> {
    const { data } = await admin
        .from('customer_identities').select('license_number').eq('user_id', userId).maybeSingle()
    return normalizeLicense(data?.license_number)
}

/** The active blocks that apply to a customer, account blocks first. */
export async function loadActiveBlocks(
    admin: AdminClient,
    userId: string,
    license?: string | null,
): Promise<BlockRow[]> {
    const lic = license === undefined ? await storedLicense(admin, userId) : normalizeLicense(license)
    // The licence is letters and digits only after normalizeLicense, so it is
    // safe inside PostgREST's or() syntax. The user id is a uuid.
    const filter = lic ? `user_id.eq.${userId},license_number.eq.${lic}` : `user_id.eq.${userId}`
    const { data, error } = await admin.from('customer_blocks').select('*').is('lifted_at', null).or(filter)
    if (error) throw new Error(`customer_blocks read failed: ${error.message}`)
    return activeBlocksFor((data ?? []) as BlockRow[], { userId, licenseNumber: lic })
}

/**
 * Throws CustomerBlockedError if the customer is blocked, by account or by
 * licence. Fails closed: if the blocklist can't be read, the caller's action
 * fails too, rather than letting a blocked customer through on a database
 * hiccup.
 */
export async function assertNotBlocked(admin: AdminClient, userId: string): Promise<void> {
    const blocks = await loadActiveBlocks(admin, userId)
    if (blocks.length > 0) throw new CustomerBlockedError()
}

/**
 * Closes every checkout the customer could still pay. Each one's PaymentIntent
 * is cancelled, and a `pending` row is marked `expired`, the way cancelBooking
 * discards a hold: no email.
 *
 * `expired` and `failed` rows are included because their intents stay payable.
 * The webhook revives either to `confirmed` when a late payment lands
 * (checkoutPaymentEffect). A cancel Stripe refuses (already succeeded or
 * already cancelled) is skipped: a payment that already succeeded is a trip,
 * and the owners decide about it like any other confirmed trip.
 */
export async function releaseOpenCheckouts(admin: AdminClient, userId: string): Promise<number> {
    const { data: rows } = await admin
        .from('bookings')
        .select('id, status, stripe_payment_intent_id')
        .eq('user_id', userId)
        .in('status', ['pending', 'expired', 'failed'])

    let released = 0
    for (const row of rows ?? []) {
        if (row.stripe_payment_intent_id) {
            try {
                await getStripe().paymentIntents.cancel(row.stripe_payment_intent_id)
                released++
            } catch (err: any) {
                console.warn(`[blocks] could not cancel intent for booking ${row.id}:`, err?.message)
            }
        }
        if (row.status === 'pending') {
            await admin
                .from('bookings')
                .update({
                    status: 'expired',
                    canceled_at: new Date().toISOString(),
                    canceled_by: 'admin',
                    cancellation_reason: 'Account blocked',
                })
                .eq('id', row.id)
                .eq('status', 'pending')
                .then(undefined, (e: any) => console.error('[blocks] could not expire hold:', e?.message))
        }
    }
    return released
}

/**
 * Called once a customer's licence number is known (verification, or an owner
 * typing it in). If another account's active block carries the same licence,
 * this account is blocked too, and the owners are emailed: that is the same
 * person, back under a new email.
 *
 * Returns whether this account is now blocked. Safe to race: the second insert
 * hits customer_blocks_one_active_per_user and is treated as already done, and
 * only the caller whose insert landed sends the email.
 */
export async function checkLicenseAgainstBlocks(admin: AdminClient, userId: string, license: string): Promise<boolean> {
    const lic = normalizeLicense(license)
    if (!lic) return false

    const blocks = await loadActiveBlocks(admin, userId, lic)
    if (blocks.some(b => b.user_id === userId)) return true
    const original = blocks[0]
    if (!original) return false

    const { data: inserted, error } = await admin
        .from('customer_blocks')
        .insert({
            user_id: userId,
            license_number: null, // the licence is already blocked, on `original`
            reason: `Same driver's licence as a blocked account. Original reason: ${original.reason}`.slice(0, MAX_BLOCK_REASON),
            source: 'license_match',
            matched_block_id: original.id,
        })
        .select('id')
        .maybeSingle()

    if (error?.code === '23505') return true
    if (error) throw new Error(`customer_blocks insert failed: ${error.message}`)
    if (!inserted) return true

    await releaseOpenCheckouts(admin, userId)

    const { data: profile } = await admin.from('profiles').select('full_name, email').eq('id', userId).maybeSingle()
    await sendAdminAlert(admin, {
        subject: 'A blocked customer verified under a new account',
        lines: [
            `${profile?.full_name || 'A new customer'} (${profile?.email || 'no email'}) verified a driver's licence that is blocked on another account.`,
            'The new account is now blocked too, so it cannot book. Nothing else has changed. Open the customer to review it or lift the block.',
        ],
        link: { path: `/admin/customers/${userId}`, text: 'Open customer' },
    })
    return true
}

export type BlockResult = {
    block: BlockRow
    releasedCheckouts: number
    upcomingTrips: { id: string; start_time: string; end_time: string; status: string }[]
}

/**
 * Blocks a customer: their account, and their licence when we have it.
 * Refuses admins, so nobody can lock the owners out.
 */
export async function blockCustomer(
    admin: AdminClient,
    input: { userId: string; reason: string; licenseNumber?: string | null; blockedBy: string },
): Promise<BlockResult> {
    const reason = input.reason.trim()
    if (!reason) throw new Error('Give a reason for the block. Only the owners see it.')
    if (reason.length > MAX_BLOCK_REASON) throw new Error(`Keep the reason under ${MAX_BLOCK_REASON} characters.`)

    const { data: profile } = await admin.from('profiles').select('id, is_admin').eq('id', input.userId).maybeSingle()
    if (!profile) throw new Error('Customer not found')
    if (profile.is_admin) throw new Error('Admins cannot be blocked.')

    const license = normalizeLicense(input.licenseNumber) ?? await storedLicense(admin, input.userId)

    const existing = await loadActiveBlocks(admin, input.userId, license)
    if (existing.some(b => b.user_id === input.userId)) throw new Error('This customer is already blocked.')

    // The licence goes on this block unless another active block already
    // carries it (the unique index allows one); then it's covered already.
    const licenseCovered = existing.some(b => normalizeLicense(b.license_number) === license)
    const { data: block, error } = await admin
        .from('customer_blocks')
        .insert({
            user_id: input.userId,
            license_number: licenseCovered ? null : license,
            reason,
            source: 'manual',
            blocked_by: input.blockedBy,
        })
        .select('*')
        .single()
    if (error?.code === '23505') throw new Error('This customer is already blocked.')
    if (error || !block) throw new Error(error?.message ?? 'Could not block this customer')

    const releasedCheckouts = await releaseOpenCheckouts(admin, input.userId)

    const { data: upcoming } = await admin
        .from('bookings')
        .select('id, start_time, end_time, status')
        .eq('user_id', input.userId)
        .eq('status', 'confirmed')
        .gt('end_time', new Date().toISOString())
        .order('start_time', { ascending: true })

    return { block: block as BlockRow, releasedCheckouts, upcomingTrips: upcoming ?? [] }
}

/**
 * Lifts every active block on this person: the one on their account, any on
 * their licence (which may sit on another account of theirs), and any
 * licence-match block that was copied from one of those. They're all the same
 * driver's licence, so lifting only some would leave them blocked.
 * Returns the other accounts that were unblocked with it.
 */
export async function unblockCustomer(
    admin: AdminClient,
    input: { userId: string; reason: string; liftedBy: string },
): Promise<{ lifted: number; alsoUnblocked: string[] }> {
    const reason = input.reason.trim()
    if (!reason) throw new Error('Give a reason for lifting the block.')
    if (reason.length > MAX_BLOCK_REASON) throw new Error(`Keep the reason under ${MAX_BLOCK_REASON} characters.`)

    const direct = await loadActiveBlocks(admin, input.userId)
    if (direct.length === 0) return { lifted: 0, alsoUnblocked: [] }

    // One level is enough: a licence-match block always points at the block
    // that carries the licence, never at another licence-match block.
    const directIds = direct.map(b => b.id)
    const { data: copies } = await admin
        .from('customer_blocks').select('*').is('lifted_at', null).in('matched_block_id', directIds)
    const blocks = [...direct, ...((copies ?? []) as BlockRow[]).filter(c => !directIds.includes(c.id))]

    let lifted = 0
    for (const b of blocks) {
        const { data } = await admin
            .from('customer_blocks')
            .update({ lifted_at: new Date().toISOString(), lifted_by: input.liftedBy, lift_reason: reason })
            .eq('id', b.id)
            .is('lifted_at', null)
            .select('id')
        lifted += data?.length ?? 0
    }

    const alsoUnblocked = blocks
        .map(b => b.user_id)
        .filter((id): id is string => Boolean(id) && id !== input.userId)
    return { lifted, alsoUnblocked }
}
