// Outbound email, sent through the Gmail API as bluefinbiz@gmail.com.
// Deliberately generic: this module knows about messages, not about bookings.
// The booking-shaped part lives in booking-email.ts.

import { google } from 'googleapis'

export type OutboundEmail = {
    to: string
    subject: string
    /** Full HTML document. Inline every style — see booking-email.ts. */
    html: string
    /** Plain-text alternative. Not optional: it's what notification previews show. */
    text: string
    /**
     * Where hitting Reply goes. Without it, a reply to a contact-form message
     * would go back to our own sending address instead of the visitor.
     */
    replyTo?: string
}

// Header values are written straight into the raw message, and a header ends at
// a line break. An address smuggling "\r\nBcc: someone@else" would add a header
// of its own — so anything with a line break is refused here, where headers are
// written, rather than trusting every caller to have validated first.
function assertSingleLine(value: string, field: string): string {
    if (/[\r\n]/.test(value)) throw new Error(`Refusing ${field} header containing a line break`)
    return value
}

// The display name on the From header. The address itself is whatever account
// the refresh token belongs to — Gmail rejects a From it doesn't own, so it is
// read from the API rather than configured.
const SENDER_NAME = 'Bluefin Rentals'

function gmailClient() {
    const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
        throw new Error('Missing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN')
    }

    const oauth2Client = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET)
    oauth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN })
    return google.gmail({ version: 'v1', auth: oauth2Client })
}

// Cached for the life of the process. The sending address changes only if the
// refresh token is re-minted against a different Google account, which means a
// restart anyway.
let cachedSenderAddress: string | null = null

async function senderAddress(gmail: ReturnType<typeof gmailClient>): Promise<string> {
    if (cachedSenderAddress) return cachedSenderAddress
    const profile = await gmail.users.getProfile({ userId: 'me' })
    const address = profile.data.emailAddress
    if (!address) throw new Error('Gmail profile returned no emailAddress')
    cachedSenderAddress = address
    return address
}

// ── MIME assembly ────────────────────────────────────────────────────────────

// Headers are ASCII-only by spec, and a guest's name goes in the subject line.
// RFC 2047 "encoded-word" is how you put anything else there; without it a
// name like "José" arrives mojibake'd or gets the header rejected outright.
function encodeHeader(value: string): string {
    // eslint-disable-next-line no-control-regex
    if (/^[\x20-\x7E]*$/.test(value)) return value
    return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

// RFC 5322 caps a line at 998 octets, and an HTML email blows past that on a
// single long <table> row. Base64 with 76-character lines sidesteps the limit
// entirely rather than relying on quoted-printable soft breaks landing well.
function base64Body(value: string): string {
    return (Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n')
}

function buildMimeMessage(msg: OutboundEmail, from: string): string {
    const boundary = `bluefin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`

    // CRLF throughout, not \n: header parsing is defined in terms of CRLF and
    // some receivers are strict about it.
    return [
        `From: ${encodeHeader(SENDER_NAME)} <${from}>`,
        `To: ${assertSingleLine(msg.to, 'To')}`,
        ...(msg.replyTo ? [`Reply-To: ${assertSingleLine(msg.replyTo, 'Reply-To')}`] : []),
        `Subject: ${encodeHeader(msg.subject)}`,
        'MIME-Version: 1.0',
        // multipart/alternative, text part first: the last part a client can
        // render is the one it shows, so HTML has to come second.
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        base64Body(msg.text),
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        base64Body(msg.html),
        '',
        `--${boundary}--`,
        '',
    ].join('\r\n')
}

/**
 * Sends one email. Throws if Gmail rejects it — callers decide what a failed
 * send means for them.
 *
 * A plain async function rather than a createServerFn on purpose: the Stripe
 * webhook (src/routes/api/stripe-webhook.ts) is a raw route handler, not a
 * server function, and can only call ordinary functions.
 */
export async function sendEmail(msg: OutboundEmail): Promise<void> {
    const gmail = gmailClient()
    const from = await senderAddress(gmail)

    // base64url, per the Gmail API's `raw` field — standard base64 breaks it,
    // because + and / are not URL-safe and the padding is rejected.
    const raw = Buffer.from(buildMimeMessage(msg, from), 'utf8').toString('base64url')

    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}