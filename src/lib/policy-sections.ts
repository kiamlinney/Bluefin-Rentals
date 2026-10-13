// The order of the terms of service, and so every section's number.
//
// /policies/terms renders its sections from this list, and anything that cites
// a section (another section, the FAQ, code comments, ImportantFiles/*.md via
// `<!-- const:TERMS_SECTION_… -->`) goes through termsSection(). Reordering the
// terms is then one edit here, and scripts/verify-policy-docs.ts fails on any
// document still quoting the old number.
//
// Pure and dependency-free: the verify scripts import it with
// node --experimental-strip-types.

export const TERMS_SECTIONS = [
    { id: 'about', title: 'Who we are and this agreement' },
    { id: 'eligibility', title: 'Who can rent, and verifying your identity' },
    { id: 'account', title: 'Your account' },
    { id: 'booking', title: 'Booking and confirmation' },
    { id: 'payment', title: 'Paying for your trip, and your card on file' },
    { id: 'deposit', title: 'Security deposit' },
    { id: 'pickup', title: 'Pickup, return and delivery' },
    { id: 'use', title: 'Using the car' },
    { id: 'mileage-fuel', title: 'Mileage and fuel' },
    { id: 'tolls', title: 'Tolls, tickets and citations' },
    { id: 'damage', title: 'Accidents, damage and theft' },
    { id: 'insurance', title: 'Insurance and protection' },
    { id: 'extensions', title: 'Extending your trip' },
    { id: 'extras', title: 'Extras' },
    { id: 'costs', title: 'Costs arising from your trip' },
    { id: 'swap', title: 'If we change your car' },
    { id: 'cancellation', title: 'Cancellations and refunds' },
    { id: 'taxes', title: 'Taxes' },
    { id: 'refusal', title: 'Refusing service and blocked accounts' },
    { id: 'content', title: 'Reviews, photos and other things you send us' },
    { id: 'disputes', title: 'Questions, disputes and chargebacks' },
    { id: 'liability', title: 'Limits of liability' },
    { id: 'general', title: 'Changes to these terms, and the rest' },
] as const

export type TermsSectionId = (typeof TERMS_SECTIONS)[number]['id']

/** The section's number, 1-based. */
export function termsSectionNumber(id: TermsSectionId): number {
    return TERMS_SECTIONS.findIndex(s => s.id === id) + 1
}

/** "section 6", for prose. */
export function termsSection(id: TermsSectionId): string {
    return `section ${termsSectionNumber(id)}`
}

/** "6. Security deposit", for a heading. */
export function termsSectionHeading(id: TermsSectionId): string {
    const s = TERMS_SECTIONS.find(x => x.id === id)!
    return `${termsSectionNumber(id)}. ${s.title}`
}
