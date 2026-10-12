// The world a test runs in: one fake database, one fake Stripe, and every email
// that would have been sent. tests/setup.ts points the real modules at these.

import { vi } from 'vitest'
import { FakeDb, type Row } from './fakes/supabase'
import { FakeStripe } from './fakes/stripe'
import { FakeGmail } from './fakes/gmail'

export type SentEmail = { to: string; subject: string; text?: string; html?: string; priority?: 'high' }

export const h = {
    db: new FakeDb(),
    stripe: new FakeStripe(),
    gmail: new FakeGmail(),
    emails: [] as SentEmail[],
    /** How many of the next sends should fail, as Gmail refusing them would. */
    failNextEmails: 0,
}

export const ADMIN_EMAIL = 'owners@test.bluefin'

/** A fresh world, at a fixed time. */
export function reset(now: string, seed: Record<string, Row[]> = {}) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    h.db = new FakeDb(seed)
    h.stripe = new FakeStripe()
    h.gmail = new FakeGmail()
    h.emails = []
    h.failNextEmails = 0
}

/** Moves the clock. */
export function at(time: string) {
    vi.setSystemTime(new Date(time))
}

/** Signs a user in for the "cookie" client (null to sign out). */
export function signIn(userId: string | null) {
    h.db.user = userId ? { id: userId } : null
}

export const emailsTo = (to: string) => h.emails.filter(e => e.to === to)
export const emailSubjects = () => h.emails.map(e => `${e.to}: ${e.subject}`)
