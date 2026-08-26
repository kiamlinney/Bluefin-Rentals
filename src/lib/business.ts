// Business facts shared by structured data and page metadata.
import { absoluteUrl, SITE_URL } from './site'

// Real operating hours. Open is 10:00 every day; only closing moves.
//
// NOTE: availability.ts still uses a single flat BUSINESS_CLOSE_MINUTES (22:30)
// for every day, so the booking calendar and this table disagree — see the
// closing times below. The calendar is the one that needs fixing.
export const OPENING_HOURS = [
    { days: ['Monday', 'Tuesday', 'Saturday', 'Sunday'], opens: '10:00', closes: '23:30' },
    { days: ['Wednesday', 'Friday'], opens: '10:00', closes: '21:30' },
    { days: ['Thursday'], opens: '10:00', closes: '22:30' },
] as const

/** "23:30" -> "11:30 PM" */
export function to12Hour(hhmm: string): string {
    const [h = 0, m = 0] = hhmm.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 === 0 ? 12 : h % 12
    return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

export const BUSINESS = {
    name: 'BlueFin Rentals',
    legalName: 'BlueFin Rentals LLC',
    city: 'Saint Paul',
    region: 'MN',
    postalCode: '55105',
    country: 'US',
    areaServed: 'Minneapolis–Saint Paul, MN',
    priceRange: '$$',
} as const

// Sharing any page without its own image falls back to this. Swap for a
// branded 1200x630 card when one exists.
export const DEFAULT_OG_IMAGE =
    'https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_10/main.PNG'


/**
 * Identifies the company itself, as opposed to the Car/Offer markup that
 * describes one vehicle. Street address and geo are deliberately omitted —
 * the home base is a residence, so this is modelled as a service-area
 * business. Add `streetAddress` and `geo` if operations move to a commercial lot.
 */
export function businessJsonLd() {
    return {
        '@context': 'https://schema.org',
        '@type': 'AutoRental',
        '@id': `${SITE_URL}/#business`,
        name: BUSINESS.name,
        legalName: BUSINESS.legalName,
        url: `${SITE_URL}/`,
        image: DEFAULT_OG_IMAGE,
        description:
            'Self-serve car rental in Saint Paul and Minneapolis. Book online, pick up locally or have the car delivered.',
        address: {
            '@type': 'PostalAddress',
            addressLocality: BUSINESS.city,
            addressRegion: BUSINESS.region,
            postalCode: BUSINESS.postalCode,
            addressCountry: BUSINESS.country,
        },
        areaServed: { '@type': 'City', name: BUSINESS.areaServed },
        openingHoursSpecification: OPENING_HOURS.map(({ days, opens, closes }) => ({
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: [...days],
            opens,
            closes,
        })),
        priceRange: BUSINESS.priceRange,
        currenciesAccepted: 'USD',
        paymentAccepted: 'Credit Card',
    }
}

type SeoInput = {
    title: string
    description: string
    path: string
    image?: string
    type?: 'website' | 'article'
}

/** Title, description, and the Open Graph/Twitter pair every page should carry. */
export function seoMeta({ title, description, path, image = DEFAULT_OG_IMAGE, type = 'website' }: SeoInput) {
    const url = absoluteUrl(path)
    return [
        { title },
        { name: 'description', content: description },
        { property: 'og:site_name', content: BUSINESS.name },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:type', content: type },
        { property: 'og:url', content: url },
        { property: 'og:image', content: image },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: image },
    ]
}