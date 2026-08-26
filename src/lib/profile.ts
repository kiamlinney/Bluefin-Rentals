// Small display helpers shared by everything that renders a renter.
//
// Both of these used to live inside src/routes/admin/reservation.$bookingId.tsx.
// They moved here when the user profile pages started needing the same output —
// two copies of the name fallback would drift, and the same renter would read
// differently depending on which page you were on.

// The name shown for a renter, in order of preference: their full name, the
// local part of their email, then a generic label. profiles.full_name is
// nullable and stays null until the driver-info step is completed, so the email
// fallback is what most pending renters actually show.
export function displayName(
    profile: { full_name?: string | null; email?: string | null } | null | undefined,
): string {
    return profile?.full_name ?? profile?.email?.split('@')[0] ?? 'Guest'
}

// Renders a stored phone number as +1 (XXX) XXX-XXXX when it really is a 10-digit
// US number, and otherwise hands back whatever was stored, untouched. Returns
// null when there's no number at all, so the caller shows "Not provided".
//
// The +1 lives in here rather than in the JSX because it's only true for numbers
// we actually recognized — prefixing it onto an unrecognized string would invent
// a country code for a number that may already carry a different one.
export function formatPhone(phone: string | null | undefined): string | null {
    if (!phone) return null
    const digits = phone.replace(/\D/g, '')
    // 11 digits starting with 1 is a US number with the country code typed in.
    const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
    if (local.length !== 10) return phone
    return `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
}