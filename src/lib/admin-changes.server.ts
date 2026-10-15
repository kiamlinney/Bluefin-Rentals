// The admin change log (admin_changes): who changed a car's listing, base
// price, mileage fee or lockbox code, or the fleet-wide pricing rules,
// and when.
//
// Server-only (.server.ts), for the same bundling reason as access.server.ts.

import type { SupabaseClient } from '@supabase/supabase-js'

type AdminClient = SupabaseClient<any, any, any>

export type AdminChange = {
    id: string
    carId: number | null
    field: string
    oldValue: string | null
    newValue: string | null
    changedByName: string | null
    createdAt: string
}

const asText = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

/**
 * Records one change. Called after the change itself has been written, and it
 * never throws: the change happened, and failing the owner's request over its
 * log line would only invite a retry that changes nothing. A failure is
 * logged for Railway instead.
 */
export async function recordAdminChange(
    admin: AdminClient,
    change: { carId: number | null; field: string; oldValue: unknown; newValue: unknown; changedBy: string },
): Promise<void> {
    const { error } = await admin.from('admin_changes').insert({
        car_id: change.carId,
        field: change.field,
        old_value: asText(change.oldValue),
        new_value: asText(change.newValue),
        changed_by: change.changedBy,
    })
    if (error) console.error(`[admin-changes] could not record ${change.field} change:`, error.message)
}

/** Newest first, with the name of whoever made each change. */
export async function loadAdminChanges(admin: AdminClient, carId: number | null, limit = 100): Promise<AdminChange[]> {
    let query = admin.from('admin_changes').select('*').order('created_at', { ascending: false }).limit(limit)
    query = carId === null ? query.is('car_id', null) : query.eq('car_id', carId)
    const { data, error } = await query
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as any[]
    const ids = [...new Set(rows.map(r => r.changed_by).filter(Boolean))]
    const names = new Map<string, string | null>()
    if (ids.length > 0) {
        const { data: people } = await admin.from('profiles').select('id, full_name, email').in('id', ids)
        for (const p of people ?? []) names.set(p.id, p.full_name || p.email)
    }

    return rows.map(r => ({
        id: r.id,
        carId: r.car_id === null || r.car_id === undefined ? null : Number(r.car_id),
        field: r.field,
        oldValue: r.old_value ?? null,
        newValue: r.new_value ?? null,
        changedByName: r.changed_by ? names.get(r.changed_by) ?? null : null,
        createdAt: r.created_at,
    }))
}
