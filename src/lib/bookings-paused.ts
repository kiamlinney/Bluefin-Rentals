// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY pre-launch stop on taking money.
//
// The site is going public before BlueFin is ready to accept real bookings, so
// a visitor can walk the whole checkout but cannot pay at the end of it.
//
// TO REMOVE: unset VITE_BOOKINGS_PAUSED, then delete this file and its two
// importers — `grep -rn BOOKINGS_PAUSED src`. Nothing else references it, and
// nothing else in the codebase changed to accommodate it.
//
// One variable rather than a client flag plus a server flag, because two can
// disagree and the disagreement is silent: a UI that hides the button while the
// server happily charges, or the reverse. `import.meta.env` is populated on both
// sides under Vite — supabase.server.ts and sitemap[.]xml.ts already read
// VITE_-prefixed values server-side — so one value covers both.
//
// Absent, empty, or anything other than 'true' means bookings work normally, so
// a forgotten env var fails open rather than quietly killing the business.
// ─────────────────────────────────────────────────────────────────────────────

export const BOOKINGS_PAUSED = import.meta.env.VITE_BOOKINGS_PAUSED === 'true'

export const BOOKINGS_PAUSED_MESSAGE =
    "We're not taking online bookings just yet — we're finishing a few things first. " +
    'Give us a call at (651) 262-9552 and we\'ll get you booked directly.'
