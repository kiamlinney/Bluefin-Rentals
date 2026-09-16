// src/routes/api/cron/sync-turo.ts
//
// Scheduled Turo sync. Called every 15 minutes by the pg_cron job
// `sync-turo-bookings` (supabase/migrations/20260915130000_schedule_turo_sync.sql) through
// pg_net, so a Turo trip lands on the site's calendar without anyone clicking
// anything. The sync itself is runTuroSync in src/lib/turo-sync.server.ts; this
// route only authenticates the caller and picks the search window.
import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import type { Database } from '../../../lib/database.types'
import {
    runTuroSync,
    TURO_SYNC_MAX_LOOKBACK_DAYS,
    TURO_SYNC_SCHEDULED_LOOKBACK_DAYS,
} from '../../../lib/turo-sync.server'

// Constant-time, so response timing can't be used to guess the secret a byte
// at a time. timingSafeEqual throws on unequal lengths, hence the length check.
function secretMatches(authorization: string | null, secret: string): boolean {
    const expected = Buffer.from(`Bearer ${secret}`)
    const given = Buffer.from(authorization ?? '')
    return given.length === expected.length && timingSafeEqual(given, expected)
}

// ?days=N widens the search for a one-off catch-up — after an outage longer
// than the scheduled window, say. Clamped, and anything unparseable falls back
// to the scheduled window rather than erroring.
function lookbackDaysFrom(request: Request): number {
    const raw = Number.parseInt(new URL(request.url).searchParams.get('days') ?? '', 10)
    if (!Number.isFinite(raw)) return TURO_SYNC_SCHEDULED_LOOKBACK_DAYS
    return Math.min(Math.max(raw, 1), TURO_SYNC_MAX_LOOKBACK_DAYS)
}

export const Route = createFileRoute('/api/cron/sync-turo')({
    server: {
        handlers: {
            POST: async ({ request }) => {
                const cronSecret = process.env.CRON_SECRET
                const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
                const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

                // Refuse outright rather than run unauthenticated: without a
                // configured secret there is nothing to check the caller against.
                if (!cronSecret) {
                    console.error('Missing CRON_SECRET for Turo sync')
                    return new Response('Server misconfigured', { status: 500 })
                }
                if (!supabaseUrl || !supabaseServiceRoleKey) {
                    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for Turo sync')
                    return new Response('Server misconfigured', { status: 500 })
                }

                if (!secretMatches(request.headers.get('authorization'), cronSecret)) {
                    return new Response('Unauthorized', { status: 401 })
                }

                // Service role: a scheduled request has no user session, and
                // turo_bookings is admin-only under RLS.
                const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
                    auth: { persistSession: false, autoRefreshToken: false },
                })

                const lookbackDays = lookbackDaysFrom(request)
                try {
                    const results = await runTuroSync(supabaseAdmin, lookbackDays)
                    // Per-email problems land in results.errors and don't fail the
                    // run; they're logged so they show up in the server's logs.
                    if (results.errors.length > 0) {
                        console.error('Turo sync finished with errors:', results.errors)
                    }
                    return Response.json({ lookbackDays, ...results })
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : 'unknown error'
                    console.error('Turo sync failed:', message)
                    return new Response(`Turo sync failed: ${message}`, { status: 500 })
                }
            },
        },
    },
})