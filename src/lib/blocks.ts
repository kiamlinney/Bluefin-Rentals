// Who is blocked, as a pure rule. Shared by the server check
// (blocks.server.ts#assertNotBlocked), the CRM pages and the tests, so "is this
// customer blocked?" has one answer everywhere.
//
// A block names an account (user_id), a driver's licence (license_number), or
// both. Blocking a customer whose licence we hold blocks both, which is what
// catches the same person signing up again under a new email: every booking
// needs ID verification, and verifying copies the licence number
// (identity.server.ts), which then matches.
//
// Isomorphic and dependency-free, like pricing.ts.

import { CONTACT_EMAIL } from './business.ts'

export type BlockRow = {
    id: string
    user_id: string | null
    license_number: string | null
    reason: string
    source: string
    matched_block_id: string | null
    blocked_by: string | null
    created_at: string
    lifted_at: string | null
    lifted_by: string | null
    lift_reason: string | null
}

export const BLOCK_SOURCES = ['manual', 'license_match'] as const
export type BlockSource = (typeof BLOCK_SOURCES)[number]

/** What a blocked guest is told. Neutral on purpose: it gives no reason to argue with. */
export const BLOCKED_MESSAGE =
    `We can't accept bookings from this account. If you think this is a mistake, contact us at ${CONTACT_EMAIL}.`

export const MAX_BLOCK_REASON = 500

/**
 * A licence number as stored and compared: upper case, letters and digits only.
 * State formats differ ("A123-456-789-012" in Minnesota) and people type them
 * with or without the dashes, so the punctuation can't be part of the identity.
 * Returns null for anything with no letters or digits.
 */
export function normalizeLicense(value: string | null | undefined): string | null {
    if (!value) return null
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    return cleaned.length > 0 ? cleaned : null
}

export const isActiveBlock = (block: Pick<BlockRow, 'lifted_at'>) => block.lifted_at == null

type BlockMatchFields = Pick<BlockRow, 'user_id' | 'license_number' | 'lifted_at'>
type Who = { userId: string; licenseNumber: string | null | undefined }

/**
 * Every active block that applies to this customer: on their account, or on
 * their licence. Unblocking lifts all of them, because a licence block is on
 * the person, and leaving it in place would keep the account blocked.
 * Account blocks come first.
 */
export function activeBlocksFor<B extends BlockMatchFields>(blocks: B[], who: Who): B[] {
    const license = normalizeLicense(who.licenseNumber)
    const active = blocks.filter(isActiveBlock)
    const onAccount = active.filter(b => b.user_id === who.userId)
    const onLicense = license
        ? active.filter(b => b.user_id !== who.userId && normalizeLicense(b.license_number) === license)
        : []
    return [...onAccount, ...onLicense]
}

/** The block that applies to this customer, or null. */
export function activeBlockFor<B extends BlockMatchFields>(blocks: B[], who: Who): B | null {
    return activeBlocksFor(blocks, who)[0] ?? null
}
