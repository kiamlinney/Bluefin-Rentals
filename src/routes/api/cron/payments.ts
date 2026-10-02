// src/routes/api/cron/payments.ts
//
// The payments sweep. Called every 15 minutes by the pg_cron job
// `payments-sweep` (supabase/migrations/20260927130000_schedule_payments_sweep.sql)
// through pg_net. The work itself is runPaymentsSweep in
// src/lib/payments.server.ts; this route only authenticates the caller.
//
// It's the backstop for everything that happens because the clock moved rather
// than because someone clicked: placing deposit holds the day before pickup,
// retrying declined ones, renewing holds on long trips before Stripe lets them
// lapse, releasing holds 72 hours after a trip, and letting go of extension
// payments nobody finished. Written up in ImportantFiles/deposit.md.
//
// Run it by hand:
//     curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://rentbluefin.com/api/cron/payments
import { createFileRoute } from '@tanstack/react-router'
import { timingSafeEqual } from 'node:crypto'
import { runPaymentsSweep, serviceRoleClient } from '../../../lib/payments.server'

// Constant-time, so response timing can't be used to guess the secret a byte
// at a time. timingSafeEqual throws on unequal lengths, hence the length check.
function secretMatches(authorization: string | null, secret: string): boolean {
    const expected = Buffer.from(`Bearer ${secret}`)
    const given = Buffer.from(authorization ?? '')
    return given.length === expected.length && timingSafeEqual(given, expected)
}

export const Route = createFileRoute('/api/cron/payments')({
    server: {
        handlers: {
            POST: async ({ request }) => {
                const cronSecret = process.env.CRON_SECRET

                // Refuse outright rather than run unauthenticated: without a
                // configured secret there is nothing to check the caller against.
                if (!cronSecret) {
                    console.error('Missing CRON_SECRET for the payments sweep')
                    return new Response('Server misconfigured', { status: 500 })
                }
                if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
                    console.error('Missing STRIPE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY for the payments sweep')
                    return new Response('Server misconfigured', { status: 500 })
                }

                if (!secretMatches(request.headers.get('authorization'), cronSecret)) {
                    return new Response('Unauthorized', { status: 401 })
                }

                try {
                    const result = await runPaymentsSweep(serviceRoleClient())
                    // Per-item problems land in result.errors and don't stop the
                    // rest of the sweep; they're logged so they reach Railway's logs.
                    if (result.errors.length > 0) {
                        console.error('Payments sweep finished with errors:', result.errors)
                    }
                    return Response.json(result)
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : 'unknown error'
                    console.error('Payments sweep failed:', message)
                    return new Response(`Payments sweep failed: ${message}`, { status: 500 })
                }
            },
        },
    },
})