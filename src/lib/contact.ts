import { createServerFn } from '@tanstack/react-start'
import z from 'zod'
import { CONTACT_EMAIL } from './business'
import { sendContactMessage } from './contact-email'

// One source for the length caps, so the form's maxLength attributes and the
// server's validation can't drift apart. Plain numbers are safe to export from
// here: this module is imported by the page, and a constant pulls in nothing
// server-only.
export const CONTACT_LIMITS = {
    name: 100,
    message: 5000,
} as const

// The browser already enforces required/type="email"/maxLength, but that's a
// convenience for honest visitors, not protection. A server function is a plain
// HTTP endpoint that anyone can POST to without loading the form, so the server
// re-checks everything. `.trim()` runs before `.min(1)`, so a name that's only
// spaces counts as empty.
const contactInput = z.object({
    name: z.string().trim().min(1, 'Please enter your name').max(CONTACT_LIMITS.name),
    email: z.string().trim().email('Please enter a valid email address'),
    message: z.string().trim().min(1, 'Please enter a message').max(CONTACT_LIMITS.message),
    // Honeypot: an input people never see and so never fill in. Bots that
    // auto-fill every field fill this one too. Optional, because a real
    // submission sends it empty.
    website: z.string().optional(),
})

export const submitContactMessage = createServerFn({ method: 'POST' })
    .inputValidator(contactInput)
    .handler(async ({ data }) => {
        // Report success without sending. An error would tell the bot it was
        // caught and invite it to try something else.
        if (data.website) return { ok: true as const }

        try {
            await sendContactMessage({ name: data.name, email: data.email, message: data.message })
        } catch (err) {
            // The real error (expired token, Gmail quota…) is for our logs. The
            // visitor gets something they can act on instead.
            console.error('[contact] send failed:', err)
            throw new Error(`Sorry, your message couldn't be sent. Please email us directly at ${CONTACT_EMAIL}.`)
        }

        return { ok: true as const }
    })