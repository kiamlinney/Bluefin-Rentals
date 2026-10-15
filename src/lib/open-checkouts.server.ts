// Closing checkouts that could still take money: a blocked customer's
// (blocks.server.ts) and an unlisted car's (vehicles.ts).
//
// Server-only (.server.ts), for the same bundling reason as access.server.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripe } from './payments.server'

type AdminClient = SupabaseClient<any, any, any>

/**
 * Closes every checkout for this customer or this car that could still be
 * paid. Each one's PaymentIntent is cancelled, and a `pending` row is marked
 * `expired`, the way cancelBooking discards a hold: no email.
 *
 * `expired` and `failed` rows are included because their intents stay payable.
 * The webhook revives either to `confirmed` when a late payment lands
 * (checkoutPaymentEffect). A cancel Stripe refuses (already succeeded or
 * already cancelled) is skipped: a payment that already succeeded is a trip,
 * and the owners decide about it like any other confirmed trip.
 *
 * Returns how many intents were cancelled.
 */
export async function releaseOpenCheckouts(
    admin: AdminClient,
    scope: { userId: string } | { carId: number },
    reason: string,
): Promise<number> {
    let query = admin
        .from('bookings')
        .select('id, status, stripe_payment_intent_id')
        .in('status', ['pending', 'expired', 'failed'])
    query = 'userId' in scope ? query.eq('user_id', scope.userId) : query.eq('car_id', scope.carId)
    const { data: rows } = await query

    let released = 0
    for (const row of rows ?? []) {
        if (row.stripe_payment_intent_id) {
            try {
                await getStripe().paymentIntents.cancel(row.stripe_payment_intent_id)
                released++
            } catch (err: any) {
                console.warn(`[checkouts] could not cancel intent for booking ${row.id}:`, err?.message)
            }
        }
        if (row.status === 'pending') {
            await admin
                .from('bookings')
                .update({
                    status: 'expired',
                    canceled_at: new Date().toISOString(),
                    canceled_by: 'admin',
                    cancellation_reason: reason,
                })
                .eq('id', row.id)
                .eq('status', 'pending')
                .then(undefined, (e: any) => console.error('[checkouts] could not expire hold:', e?.message))
        }
    }
    return released
}
