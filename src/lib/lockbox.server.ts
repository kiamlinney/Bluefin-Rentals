// The lockbox code, and the rule for when a guest may have it.
//
// Decided by the owners on 2026-09-25: the code is withheld until the trip's
// security deposit hold has gone through (or an owner waived it). The code opens
// a real car, and the hold is what stands behind it. See
// ImportantFiles/deposit.md.
//
// Server-only: car_secrets is readable by no client role, and every caller here
// has already authorized the viewer. Owners always see the code — this rule is
// about what a guest is given.

import type { SupabaseClient } from '@supabase/supabase-js'
import { depositIsDue, depositPlaceAt, type DepositState } from './deposit.ts'

type AdminClient = SupabaseClient<any, any, any>

/** Reads the car's current lockbox code. Never throws — a missing code sends a
 *  message without one, which is better than sending nothing. */
export async function lockboxCodeForCar(
    supabaseAdmin: AdminClient,
    carId: number,
): Promise<string | null> {
    try {
        const { data } = await supabaseAdmin
            .from('car_secrets')
            .select('lockbox_code')
            .eq('car_id', carId)
            .maybeSingle()
        return (data?.lockbox_code as string | null) ?? null
    } catch (err: any) {
        console.error('[lockbox] could not read lockbox code:', err?.message || err)
        return null
    }
}

export type DepositGateBooking = {
    id: string
    start_time: string
    end_time: string
    deposit_waived_at: string | null
    /** Optional so older callers keep working; without it the trip is assumed live. */
    status?: string
}

/**
 * Where a trip stands on its deposit, read from the ledger.
 *
 * `held` counts a captured hold too: money kept for damage still stood behind
 * the trip. A released hold only happens after the trip, or when it's replaced.
 */
export async function depositStateFor(
    supabaseAdmin: AdminClient,
    booking: DepositGateBooking,
    now: Date = new Date(),
): Promise<DepositState> {
    if (booking.deposit_waived_at) return 'waived'

    const start = new Date(booking.start_time)
    const end = new Date(booking.end_time)

    const { data } = await supabaseAdmin
        .from('booking_charges')
        .select('status')
        .eq('booking_id', booking.id)
        .eq('kind', 'deposit')
        .in('status', ['authorized', 'succeeded'])
        .limit(1)

    if (data && data.length > 0) return 'held'

    // A cancelled or finished trip isn't owed a hold, whatever the clock says.
    // Without this, a trip cancelled inside the hold window — its hold released
    // by the cancellation — read as `missing`, and the guest was told "we
    // couldn't place your security hold" on a trip that no longer exists. After
    // the `held` check on purpose: a trip that has ended is marked `completed`
    // while its hold stays on for the inspection window, and that hold must
    // still show.
    if (booking.status && booking.status !== 'confirmed' && booking.status !== 'pending') return 'done'

    if (now < depositPlaceAt(start)) return 'not-yet'
    if (!depositIsDue(start, end, now)) return 'done'
    return 'missing'
}

/**
 * The code a *guest* may see for this booking right now, or null.
 *
 * Null unless the trip is confirmed, hasn't ended, and has a hold or a waiver.
 */
export async function guestLockboxCode(
    supabaseAdmin: AdminClient,
    booking: DepositGateBooking & { car_id: number; status: string },
    now: Date = new Date(),
): Promise<string | null> {
    if (booking.status !== 'confirmed') return null
    if (new Date(booking.end_time) <= now) return null

    const state = await depositStateFor(supabaseAdmin, booking, now)
    if (state !== 'held' && state !== 'waived') return null

    return lockboxCodeForCar(supabaseAdmin, booking.car_id)
}