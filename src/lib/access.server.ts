// Who may touch a booking, and the service-role client used once they may.
//
// Moved out of db.ts so the payment server functions in src/lib/payments.ts can
// share the exact same checks. Server-only (.server.ts): db.ts and payments.ts
// are imported by browser pages, and only createServerFn handler bodies are
// stripped from the client bundle — a plain exported function would drag the
// cookie client along with it. Same reason turo-sync.server.ts exists.
//
// There is no centralized admin middleware (CLAUDE.md): every privileged server
// function calls one of these itself, because server functions can be called
// directly, not just through a route's loader.

import { createClient } from '@supabase/supabase-js'
import { getSupabaseServerClient } from './supabase.server'

export function getServiceRoleClient() {
    return createClient(
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
    )
}

// Admins, or the renter on the booking. Every booking-scoped server function
// calls this itself: route-level admin auth does not cover server functions
// invoked directly.
export async function assertBookingAccess(bookingId: string) {
    const supabase = getSupabaseServerClient()
    const authResult = await supabase.auth.getUser()
    const user = authResult.data.user
    if (!user) throw new Error('Not authenticated')

    const { data: profile } = await supabase
        .from('profiles').select('is_admin').eq('id', user.id).single()

    const supabaseAdmin = getServiceRoleClient()
    const { data: booking, error } = await supabaseAdmin
        .from('bookings')
        .select('id, user_id')
        .eq('id', bookingId)
        .single()

    if (error || !booking) throw new Error('Booking not found')

    const isAdmin = Boolean(profile?.is_admin)
    if (!isAdmin && booking.user_id !== user.id) throw new Error('Not authorized')

    return { user, isAdmin, supabase, supabaseAdmin }
}

export async function requireUser() {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase.auth.getUser()
    if (!data.user) throw new Error('Not authenticated')
    return { user: data.user, supabase }
}

export async function requireAdmin() {
    const { user, supabase } = await requireUser()
    const { data: profile } = await supabase
        .from('profiles').select('is_admin').eq('id', user.id).single()
    if (!profile?.is_admin) throw new Error('Not authorized')
    return { user }
}