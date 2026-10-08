// Business facts shared by structured data and page metadata.
import { absoluteUrl, SITE_URL } from './site'
import { carMainImageUrl } from './car-images'
import { BUSINESS_CLOSE_MINUTES, BUSINESS_OPEN_MINUTES } from './availability'

/** 600 -> "10:00" */
const toHhmm = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

// Operating hours, the same every day. Built from the constants the booking
// calendar uses, so the hours we publish are the hours a trip can start and end.
export const OPENING_HOURS = [
    {
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        opens: toHhmm(BUSINESS_OPEN_MINUTES),
        closes: toHhmm(BUSINESS_CLOSE_MINUTES),
    },
] as const

/** "23:30" -> "11:30 PM", "23:00" -> "11 PM" */
export function to12Hour(hhmm: string): string {
    const [h = 0, m = 0] = hhmm.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 === 0 ? 12 : h % 12
    return m === 0 ? `${hour} ${period}` : `${hour}:${String(m).padStart(2, '0')} ${period}`
}

/** "10 AM to 11 PM" — for prose. Every day keeps the same hours, so one range covers them. */
export const DAILY_HOURS = `${to12Hour(OPENING_HOURS[0].opens)} to ${to12Hour(OPENING_HOURS[0].closes)}`

export const BUSINESS = {
    name: 'Bluefin Rentals',
    legalName: 'Bluefin Rentals LLC',
    city: 'Saint Paul',
    region: 'MN',
    postalCode: '55105',
    country: 'US',
    areaServed: 'Minneapolis–Saint Paul, MN',
    priceRange: '$$',
} as const

// Shown on /contact. Kept here with the other business facts
export const CONTACT_EMAIL = 'bluefinbiz@gmail.com'

// The number customers are told to call. Here rather than typed into each page
// that offers it: it had been copied into two files, and a business phone number
// that only *mostly* gets updated is worse than one that isn't shown at all.
export const CONTACT_PHONE = '(612) 718-5602'
// tel: wants digits, not the display formatting.
export const CONTACT_PHONE_HREF = `tel:+1${CONTACT_PHONE.replace(/\D/g, '')}`

// null until the account exists
export const INSTAGRAM_URL: string | null = null

// Sharing any page without its own image falls back to this. 
// TODO: Swap for a branded 1200x630 card when one exists.
export const DEFAULT_OG_IMAGE = carMainImageUrl(3)


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