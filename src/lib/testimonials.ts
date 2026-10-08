// Statements from guests who've rented with us many times, shown on
// /testimonials. Separate from reviews: a review is about one trip and lives in
// the database, a testimonial is a guest's own words about renting with us and
// lives here, added by hand.
//
// Before adding one:
//   - Get the guest's written OK to publish both the words and the name as they
//     appear here, and keep that email. If we trim a quote for length, they
//     approve the trimmed version.
//   - Don't give anything (a discount, a free day) in exchange for a statement
//     unless the page says so. An undisclosed paid-for testimonial is deceptive
//     advertising.
//
// Order matters: the page shows them in this order, and the About page features
// the first one, so put the strongest first.
//
// While this list is empty, /testimonials is a 404 and nothing links to it.

export type Testimonial = {
    quote: string
    /** As the guest agreed to be named, e.g. "Sarah K." or "The Okafor family". */
    name: string
    /** 'YYYY-MM': the month the guest gave us the statement. */
    date: string
}

export const TESTIMONIALS: Testimonial[] = [
    //{ quote: 'MMMMMMM YES YEP YEP YES MMM YES YUMMY FOOORD FUSION MMM YES EXQUISITE MAGNIFICENT DELICIOUS BOMBOCLAT WOMBO COMBO WOOOOOOOOOOOOOOOOOOO im a bad ceo', name: 'Bick N.', date: '2026-08' },
]

export const HAS_TESTIMONIALS = TESTIMONIALS.length > 0

/** '2026-08' -> 'August 2026'. Built and formatted in UTC so it can't slip a month. */
export function formatTestimonialDate(date: string): string {
    const year = Number(date.slice(0, 4))
    const month = Number(date.slice(5, 7))
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    })
}
