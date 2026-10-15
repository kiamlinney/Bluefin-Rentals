// Signing in with an owner's username instead of an email.
//
// What matters: a username signs in as exactly the account it belongs to,
// whatever its capitals; an email still works as it always did; and a name
// nobody has fails with the same words as a wrong password, so the form can't
// be used to find out which usernames exist.

import { beforeEach, describe, expect, it } from 'vitest'
import { h, reset } from './harness'
import { loginUser } from '../src/lib/auth'
import { INVALID_LOGIN, parseLoginIdentifier } from '../src/lib/login.server'

const JADE = { id: '00000000-0000-4000-8000-0000000000a1', email: 'bluefinbiz+jade@gmail.com', password: 'jade-pass' }
const NICK = { id: '00000000-0000-4000-8000-0000000000a2', email: 'bluefinbiz+nick@gmail.com', password: 'nick-pass' }
const GUEST = { id: '00000000-0000-4000-8000-0000000000a3', email: 'guest@example.com', password: 'guest-pass' }

beforeEach(() => {
    reset('2026-10-15T17:00:00Z', {
        login_usernames: [
            { username: 'jade', user_id: JADE.id },
            { username: 'nick', user_id: NICK.id },
        ],
    })
    h.db.authUsers = [JADE, NICK, GUEST]
})

const login = (identifier: string, password: string) => loginUser({ data: { identifier, password } })

describe('parseLoginIdentifier', () => {
    it('reads anything with an @ as an email, untouched apart from spaces', () => {
        expect(parseLoginIdentifier(' Guest@Example.com ')).toEqual({ kind: 'email', email: 'Guest@Example.com' })
    })

    it('reads anything else as a username, lowercased and trimmed', () => {
        expect(parseLoginIdentifier('  JaDe ')).toEqual({ kind: 'username', username: 'jade' })
    })
})

describe('loginUser', () => {
    it('signs a username in as its own account', async () => {
        const user = await login('jade', JADE.password)
        expect(user.id).toBe(JADE.id)
        expect(h.db.user?.id).toBe(JADE.id)

        const nick = await login('nick', NICK.password)
        expect(nick.id).toBe(NICK.id)
    })

    it('ignores capitals and stray spaces in a username', async () => {
        expect((await login(' Jade ', JADE.password)).id).toBe(JADE.id)
        expect((await login('JADE', JADE.password)).id).toBe(JADE.id)
    })

    it("refuses a username with another owner's password", async () => {
        await expect(login('jade', NICK.password)).rejects.toThrow(INVALID_LOGIN)
        expect(h.db.user).toBeNull()
    })

    it('answers an unknown username exactly as it answers a wrong password', async () => {
        const unknown = await login('nobody', 'whatever').catch((e: Error) => e.message)
        const wrong = await login('jade', 'wrong').catch((e: Error) => e.message)
        expect(unknown).toBe(INVALID_LOGIN)
        expect(unknown).toBe(wrong)
        expect(h.db.user).toBeNull()
    })

    it('still signs a guest in by email, without reading the username table', async () => {
        h.db.log = []
        expect((await login('guest@example.com', GUEST.password)).id).toBe(GUEST.id)
        expect(h.db.log.some(l => l.table === 'login_usernames')).toBe(false)
    })

    it("signs an owner in by their email too", async () => {
        expect((await login('bluefinbiz+nick@gmail.com', NICK.password)).id).toBe(NICK.id)
    })

    it('treats a username whose account is gone as unknown', async () => {
        h.db.authUsers = h.db.authUsers.filter(u => u.id !== NICK.id)
        await expect(login('nick', NICK.password)).rejects.toThrow(INVALID_LOGIN)
    })

    it('refuses an empty identifier before reaching Supabase', async () => {
        await expect(login('   ', 'x')).rejects.toThrow()
        expect(h.db.user).toBeNull()
    })
})
