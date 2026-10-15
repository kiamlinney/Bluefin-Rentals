// Signing in with a username instead of an email.
//
// Only owners have usernames (login_usernames, service role only, rows added by
// hand in 20261015120000_login_usernames.sql), so a guest always types an email.
// The username is turned into its account's email here, on the server, and
// loginUser then signs in with that email exactly as before. The browser never
// learns which email a username belongs to.
//
// Server-only (.server.ts) because auth.ts is imported by browser pages; see
// access.server.ts.

import { getServiceRoleClient } from './access.server.ts'

/** Supabase's own message for a wrong password, reused so an unknown username
 *  reads the same and the form can't be used to find out which names exist. */
export const INVALID_LOGIN = 'Invalid login credentials'

export type LoginIdentifier =
    | { kind: 'email'; email: string }
    | { kind: 'username'; username: string }

/** Anything with an "@" is an email; anything else is a username, matched
 *  without regard to case ("Jade" is "jade"). */
export function parseLoginIdentifier(identifier: string): LoginIdentifier {
    const trimmed = identifier.trim()
    return trimmed.includes('@')
        ? { kind: 'email', email: trimmed }
        : { kind: 'username', username: trimmed.toLowerCase() }
}

/** The email to sign in with. Throws INVALID_LOGIN for a username nobody has. */
export async function emailForLogin(identifier: string): Promise<string> {
    const parsed = parseLoginIdentifier(identifier)
    if (parsed.kind === 'email') return parsed.email

    const supabase = getServiceRoleClient()
    const { data: row, error } = await supabase
        .from('login_usernames')
        .select('user_id')
        .eq('username', parsed.username)
        .maybeSingle()
    if (error) {
        console.error('login_usernames lookup failed', error)
        throw new Error('Login failed, please try again.')
    }
    if (!row) throw new Error(INVALID_LOGIN)

    const { data, error: userErr } = await supabase.auth.admin.getUserById(row.user_id)
    if (userErr || !data.user?.email) {
        console.error('login username has no account', parsed.username, userErr)
        throw new Error(INVALID_LOGIN)
    }
    return data.user.email
}
