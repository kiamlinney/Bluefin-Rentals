// An in-memory stand-in for the slice of the Gmail API the Turo sync reads:
// users.messages.list and users.messages.get (format 'full').
//
// It doesn't model Gmail's search: list() returns every message, newest first,
// as Gmail does. What the sync asks Gmail for is checked separately
// (turoGmailQuery in tests/turo-email.test.ts); `queries` records it.

export type FakeEmail = {
    id: string
    /** When Gmail received it: becomes internalDate. */
    sentAt: string
    /** The Notification-Name header, or null for none. */
    notification: string | null
    subject: string
    reservationId?: string | null
    /** The text/plain part, or null for an email without one. */
    body?: string | null
}

export class FakeGmail {
    messages: FakeEmail[] = []
    queries: string[] = []
    /** How many times each message was fetched. */
    fetched = new Map<string, number>()

    add(email: FakeEmail): FakeEmail {
        this.messages.push(email)
        return email
    }

    users = {
        messages: {
            list: async ({ q }: { q: string; pageToken?: string }) => {
                this.queries.push(q)
                const newestFirst = [...this.messages].sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
                return { data: { messages: newestFirst.map(m => ({ id: m.id })), nextPageToken: undefined } }
            },
            get: async ({ id }: { id: string }) => {
                const email = this.messages.find(m => m.id === id)
                if (!email) throw new Error(`fake gmail: no message ${id}`)
                this.fetched.set(id, (this.fetched.get(id) ?? 0) + 1)
                const headers = [
                    { name: 'Subject', value: email.subject },
                    ...(email.notification ? [{ name: 'Notification-Name', value: email.notification }] : []),
                    ...(email.reservationId ? [{ name: 'Reservation-ID', value: email.reservationId }] : []),
                ]
                return {
                    data: {
                        id,
                        internalDate: String(Date.parse(email.sentAt)),
                        payload: {
                            mimeType: 'multipart/alternative',
                            headers,
                            parts: [
                                ...(email.body != null
                                    ? [{ mimeType: 'text/plain', body: { data: Buffer.from(email.body).toString('base64url') } }]
                                    : []),
                                { mimeType: 'text/html', body: { data: Buffer.from('<p>html</p>').toString('base64url') } },
                            ],
                        },
                    },
                }
            },
        },
    }
}
