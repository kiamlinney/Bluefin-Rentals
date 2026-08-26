// One-off local helper to mint a fresh GMAIL_REFRESH_TOKEN — either when Gmail
// sync starts failing with "invalid_grant" (the old refresh token expired/was
// revoked), or when the scopes below change and the stored token predates them.
// Not part of the app — run manually with:
//
//   node scripts/gmail-refresh-token.mjs
//
// Prerequisite: http://localhost:3000/oauth2callback must be listed under
// "Authorized redirect URIs" for this OAuth client in Google Cloud Console
// (APIs & Services > Credentials > this Client ID). Add it there first if
// it's missing, or change REDIRECT_URI below to one that's already listed.
import 'dotenv/config'
import http from 'node:http'
import { google } from 'googleapis'
import open from 'open'

const REDIRECT_URI = 'http://localhost:3000/oauth2callback'
const PORT = 3000

const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET } = process.env
if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    console.error('Missing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in .env')
    process.exit(1)
}

const oauth2Client = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, REDIRECT_URI)

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh_token back at all
    prompt: 'consent',      // forces re-consent so Google issues a NEW refresh_token
    // readonly for syncTuroBookings, send for the admin booking email
    // (src/lib/email.ts). Both, not either: a token minted with only one of
    // them breaks the other feature with "insufficient authentication scopes".
    scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
    ],
})

const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith('/oauth2callback')) {
        res.writeHead(404).end()
        return
    }

    const url = new URL(req.url, REDIRECT_URI)
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')

    if (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end(`Google returned an error: ${error}`)
        console.error('Google returned an error:', error)
        server.close()
        process.exit(1)
    }

    if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Missing ?code in callback')
        return
    }

    try {
        const { tokens } = await oauth2Client.getToken(code)
        res.writeHead(200, { 'Content-Type': 'text/plain' })
            .end('Success — you can close this tab and go back to the terminal.')

        if (!tokens.refresh_token) {
            console.error(
                '\nNo refresh_token in the response. This usually means this Google account already\n' +
                'has a valid grant for this client. Revoke access at https://myaccount.google.com/permissions\n' +
                '(look for this app) and re-run this script.'
            )
            process.exit(1)
        }

        console.log('\nNew refresh token (put this in .env as GMAIL_REFRESH_TOKEN):\n')
        console.log(tokens.refresh_token)
        console.log()
        server.close()
        process.exit(0)
    } catch (err) {
        console.error('\nFailed to exchange code for tokens:', err?.response?.data || err.message)
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Token exchange failed — see terminal.')
        server.close()
        process.exit(1)
    }
})

server.listen(PORT, async () => {
    console.log(`Listening on ${REDIRECT_URI} — opening consent screen in your browser...`)
    console.log('If nothing opens, visit this URL manually:\n')
    console.log(authUrl)
    console.log()
    await open(authUrl)
})