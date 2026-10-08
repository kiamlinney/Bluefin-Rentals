// Points the real server modules at the fakes in tests/harness.ts.
//
// What is replaced, and nothing else:
//   - Stripe            → FakeStripe   (no network, no money)
//   - Supabase clients  → FakeDb       (both the service-role and the cookie client)
//   - Gmail (sendEmail) → recorded in h.emails
//   - createServerFn    → calls the handler directly, so server functions are
//                         tested exactly as the browser or a direct caller sees them
//
// The code under test — db.ts, payments.server.ts, the webhook, the emails'
// queries and templates — is the real code.

import { vi } from 'vitest'
import { h, ADMIN_EMAIL } from './harness'

process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake'
process.env.SUPABASE_URL = 'http://fake.supabase'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-fake'
process.env.ADMIN_NOTIFICATION_EMAIL = ADMIN_EMAIL
process.env.SITE_URL = 'https://test.bluefin'

// A stand-in that always forwards to the current test's fake, because modules
// create their clients once, at import, and outlive any one test.
const live = <T extends object>(pick: () => T): T =>
    new Proxy({} as T, {
        get: (_, key) => {
            const target = pick() as any
            const value = target[key]
            return typeof value === 'function' ? value.bind(target) : value
        },
    })

vi.mock('stripe', () => {
    function Stripe() {
        return live(() => h.stripe)
    }
    return { default: Stripe }
})

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => live(() => h.db),
}))

vi.mock('../src/lib/supabase.server', () => ({
    getSupabaseServerClient: () => live(() => h.db),
}))

vi.mock('../src/lib/email', () => ({
    sendEmail: async (msg: { to: string; subject: string; text?: string; html?: string }) => {
        h.emails.push({ to: msg.to, subject: msg.subject, text: msg.text, html: msg.html })
    },
}))

vi.mock('googleapis', () => ({ google: {} }))

vi.mock('@tanstack/react-start', () => ({
    createServerFn: () => {
        let validate: ((input: any) => any) | null = null
        const builder: any = {
            inputValidator(fn: (input: any) => any) {
                validate = fn
                return builder
            },
            middleware() {
                return builder
            },
            handler(fn: (ctx: { data: any }) => any) {
                return (arg?: { data?: any }) => fn({ data: validate ? validate(arg?.data) : arg?.data })
            },
        }
        return builder
    },
}))
