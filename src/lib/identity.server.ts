// The driver's licence, as Stripe Identity verified it, copied into
// customer_identities for the CRM.
//
// Why a copy, not a live read: Stripe returns the sensitive fields (licence
// number, date of birth, expiry, the photos) only to a *restricted* key with
// "Recent Detailed Verification Results", and only for 48 hours after the
// verification. Reading them later needs an IP-restricted key, and Railway has
// fixed outgoing IPs only on Pro. So the moment a session is verified (the
// webhook, or finalizeIdentitySession), the fields are copied here.
//
// The photos are never copied. Inside the 48 hours the CRM shows them through
// 30-second FileLinks; after that it links to the session in the Stripe
// Dashboard, where they stay.
//
// Server-only (.server.ts): the restricted key must never reach a browser
// bundle, and db.ts is imported by pages.

import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripe } from './payments.server'
import { normalizeLicense } from './blocks.ts'
import { checkLicenseAgainstBlocks } from './blocks.server'

type AdminClient = SupabaseClient<any, any, any>

/** How long Stripe lets a non-IP-restricted key read sensitive results. */
export const SENSITIVE_RESULTS_WINDOW_MS = 48 * 3600 * 1000

/** Stripe's limit for a FileLink to an identity document or selfie. */
const IMAGE_LINK_SECONDS = 30

let restrictedClient: Stripe | null | undefined

/**
 * The restricted key's client, or null when STRIPE_IDENTITY_RESTRICTED_KEY is
 * unset. Unset degrades, never throws: verification still works, the CRM just
 * has no licence number or photos for that guest.
 */
function restrictedStripe(): Stripe | null {
    if (restrictedClient === undefined) {
        const key = process.env.STRIPE_IDENTITY_RESTRICTED_KEY
        restrictedClient = key ? new Stripe(key) : null
    }
    return restrictedClient
}

/** Tests flip the env var between cases; this forgets the cached client. */
export function resetRestrictedStripeForTests() {
    restrictedClient = undefined
}

type StripeDate = { day: number | null; month: number | null; year: number | null } | null | undefined

/** Stripe's {day, month, year} as a Postgres date, or null if any part is missing. */
export function stripeDate(d: StripeDate): string | null {
    if (!d?.day || !d.month || !d.year) return null
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.year}-${pad(d.month)}-${pad(d.day)}`
}

export function stripeIdentityDashboardUrl(sessionId: string, livemode: boolean): string {
    return `https://dashboard.stripe.com/${livemode ? '' : 'test/'}identity/verification-sessions/${sessionId}`
}

/**
 * Copies a verified session into customer_identities, then checks its licence
 * against the blocklist.
 *
 * Safe to run more than once, and from both verified paths at the same time:
 * it's an upsert on user_id, and the licence-match block it may add is claimed
 * on a unique index. The user comes from the session's metadata, which
 * createIdentitySession wrote; never from a caller.
 *
 * The sensitive columns are only ever written by a read that got them. A later
 * read outside the 48 hours (refreshIdentityFromStripe) leaves them alone
 * instead of nulling them.
 *
 * Throws only when Stripe or the database fails outright, so the webhook can
 * answer 500 and Stripe retries, which it will well inside the 48 hours.
 */
export async function recordVerifiedIdentity(
    admin: AdminClient,
    sessionId: string,
): Promise<{ userId: string; sensitiveCaptured: boolean; blocked: boolean } | null> {
    const session = await getStripe().identity.verificationSessions.retrieve(sessionId, {
        expand: ['verified_outputs', 'last_verification_report'],
    })
    const userId = session.metadata?.userId
    if (!userId) {
        console.warn(`[identity] session ${sessionId} has no metadata.userId; nothing recorded`)
        return null
    }
    if (session.status !== 'verified') return null

    const outputs = session.verified_outputs
    const report = typeof session.last_verification_report === 'object' ? session.last_verification_report : null
    const doc = report?.document ?? null
    const address = doc?.address ?? outputs?.address ?? null

    const row: Record<string, unknown> = {
        user_id: userId,
        verification_session_id: session.id,
        livemode: session.livemode,
        verified_at: report ? new Date(report.created * 1000).toISOString() : new Date().toISOString(),
        first_name: outputs?.first_name ?? doc?.first_name ?? null,
        last_name: outputs?.last_name ?? doc?.last_name ?? null,
        document_type: doc?.type ?? null,
        issuing_country: doc?.issuing_country ?? null,
        issuing_state: address?.state ?? null,
        issued_date: stripeDate(doc?.issued_date),
        address,
        updated_at: new Date().toISOString(),
    }

    const sensitive = await readSensitiveFields(sessionId)
    if (sensitive) {
        Object.assign(row, sensitive, { sensitive_captured: true })
    }

    const { error } = await admin.from('customer_identities').upsert(row, { onConflict: 'user_id' })
    if (error) throw new Error(`customer_identities upsert failed: ${error.message}`)

    const blocked = sensitive?.license_number
        ? await checkLicenseAgainstBlocks(admin, userId, sensitive.license_number)
        : false

    return { userId, sensitiveCaptured: Boolean(sensitive), blocked }
}

/**
 * The fields only the restricted key can read, or null when it can't: the key
 * is unset, Stripe refuses (outside the 48 hours, or the key lacks the
 * permission), or the network fails. Never throws; the rest of the record is
 * still worth keeping.
 */
async function readSensitiveFields(sessionId: string) {
    const stripe = restrictedStripe()
    if (!stripe) return null
    try {
        const session = await stripe.identity.verificationSessions.retrieve(sessionId, {
            expand: [
                'verified_outputs.dob',
                'last_verification_report.document.number',
                'last_verification_report.document.expiration_date',
            ],
        })
        const report = typeof session.last_verification_report === 'object' ? session.last_verification_report : null
        return {
            dob: stripeDate(session.verified_outputs?.dob),
            license_number: normalizeLicense(report?.document?.number),
            expiration_date: stripeDate(report?.document?.expiration_date),
        }
    } catch (err: any) {
        console.warn(`[identity] restricted read of ${sessionId} refused:`, err?.message || err)
        return null
    }
}

export type IdentityImages =
    | { available: true; images: { label: string; url: string }[] }
    | { available: false; reason: string }

/**
 * Short-lived links to the licence photos and the selfie, for an admin page to
 * show straight away. Stripe allows these for 48 hours after verification;
 * after that the photos are in the Stripe Dashboard only.
 */
export async function identityImageLinks(sessionId: string): Promise<IdentityImages> {
    const stripe = restrictedStripe()
    if (!stripe) return { available: false, reason: 'STRIPE_IDENTITY_RESTRICTED_KEY is not set on the server.' }

    let report: Stripe.Identity.VerificationReport | null = null
    try {
        const session = await stripe.identity.verificationSessions.retrieve(sessionId, {
            expand: ['last_verification_report'],
        })
        report = typeof session.last_verification_report === 'object' ? session.last_verification_report : null
    } catch (err: any) {
        return { available: false, reason: `Stripe refused: ${err?.message || 'unknown error'}` }
    }
    if (!report) return { available: false, reason: 'This verification has no report.' }
    if (Date.now() - report.created * 1000 > SENSITIVE_RESULTS_WINDOW_MS) {
        return { available: false, reason: 'More than 48 hours since verification.' }
    }

    const files: { label: string; file: string }[] = []
    const docFiles = report.document?.files ?? []
    docFiles.forEach((file, i) => files.push({ label: i === 0 ? 'Licence front' : i === 1 ? 'Licence back' : `Document ${i + 1}`, file }))
    if (report.selfie?.selfie) files.push({ label: 'Selfie', file: report.selfie.selfie })
    if (files.length === 0) return { available: false, reason: 'Stripe kept no images for this verification.' }

    try {
        const expiresAt = Math.floor(Date.now() / 1000) + IMAGE_LINK_SECONDS
        const images = await Promise.all(files.map(async f => {
            const link = await stripe.fileLinks.create({ file: f.file, expires_at: expiresAt })
            return { label: f.label, url: link.url ?? '' }
        }))
        return { available: true, images: images.filter(i => i.url) }
    } catch (err: any) {
        return { available: false, reason: `Stripe refused the image links: ${err?.message || 'unknown error'}` }
    }
}
