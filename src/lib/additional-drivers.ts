// Additional drivers on a booking.
//
// Pure and isomorphic like reviews.ts, so the dialog can reject bad input
// before a round trip and the server can reject it again without a second
// implementation of the rules. The server's copy is the one that counts — the
// dialog's is a courtesy.

export const MAX_ADDITIONAL_DRIVERS = 3

// The floor, not the policy. BlueFin verifies a driver in person at pickup;
// this only stops an obviously ineligible one being added in the first place.
export const MIN_DRIVER_AGE_YEARS = 21

export const DRIVER_NAME_MAX = 80
export const DRIVER_EMAIL_MAX = 254

export type DriverInput = {
    fullName: string
    email: string
    /** 'YYYY-MM-DD', the same shape BirthdayPicker and profiles.date_of_birth use. */
    dateOfBirth: string
}

/**
 * A driver as the pages render one.
 *
 * Deliberately narrower than the table row: `created_by` is a user id that no
 * page displays, and shipping it to the browser would be the same mistake
 * BOOKING_PROFILE_COLUMNS exists to correct. The server functions select
 * exactly these columns.
 */
export type TripDriver = {
    id: string
    booking_id: string
    full_name: string
    email: string
    date_of_birth: string
    created_at: string
}

export type DriverValidation =
    | { ok: true; value: DriverInput }
    | { ok: false; error: string }

/** Whole years old on `asOf`. Calendar arithmetic, no timezone dependence. */
export function driverAge(dateOfBirth: string, asOf: Date = new Date()): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth)
    if (!match) return NaN

    const [, y, m, d] = match.map(Number) as [unknown, number, number, number]
    let age = asOf.getFullYear() - y
    // Birthday hasn't come round yet this year.
    if (asOf.getMonth() + 1 < m || (asOf.getMonth() + 1 === m && asOf.getDate() < d)) age -= 1
    return age
}

// Deliberately loose. An email is verified by mail reaching it, not by a regex,
// and the elaborate ones reject addresses that genuinely work.
function looksLikeEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function validateDriver(input: DriverInput, now: Date = new Date()): DriverValidation {
    const fullName = input.fullName.trim()
    const email = input.email.trim().toLowerCase()
    const dateOfBirth = input.dateOfBirth.trim()

    if (fullName.length < 2) return { ok: false, error: "Enter the driver's full name." }
    if (fullName.length > DRIVER_NAME_MAX) {
        return { ok: false, error: `Name must be ${DRIVER_NAME_MAX} characters or fewer.` }
    }

    if (!looksLikeEmail(email)) return { ok: false, error: 'Enter a valid email address.' }
    if (email.length > DRIVER_EMAIL_MAX) {
        return { ok: false, error: 'That email address is too long.' }
    }

    const age = driverAge(dateOfBirth, now)
    if (!Number.isFinite(age)) return { ok: false, error: "Enter the driver's date of birth." }
    if (age < MIN_DRIVER_AGE_YEARS) {
        return { ok: false, error: `Drivers must be at least ${MIN_DRIVER_AGE_YEARS} years old.` }
    }
    // Not a real rule, just a typo guard — a 1902 birth year is a slipped digit.
    if (age > 110) return { ok: false, error: 'Check the date of birth.' }

    // Normalized, so the caller stores the trimmed and lowercased forms the
    // unique index is built on rather than whatever was typed.
    return { ok: true, value: { fullName, email, dateOfBirth } }
}
