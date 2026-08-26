// FAQ content, shared by the /faq page and its FAQPage structured data.
//
// Every answer below is derived from a rule that actually exists in the code
// (pricing.ts, availability.ts, pickup.ts). 
import { DELIVERY_FEE, DELIVERY_RADIUS_MILES } from './pickup'
import { MIN_LEAD_TIME_HOURS } from './availability'
import { BUSINESS } from './business'

export type FaqItem = { question: string; answer: string }

const money = (n: number) => `$${n}`

export const FAQS: FaqItem[] = [
    {
        question: 'How far in advance do I need to book?',
        answer: `Bookings must start at least ${MIN_LEAD_TIME_HOURS} hours from now, so same-day rentals are fine as long as there's ${MIN_LEAD_TIME_HOURS} hours' notice. The booking calendar only offers times that meet this.`,
    },
    {
        question: 'What are your pickup and return hours?',
        answer:
            'We open at 10:00 AM every day. We close at 11:30 PM Monday, Tuesday, Saturday, and Sunday; 10:30 PM on Thursday; and 9:30 PM on Wednesday and Friday.',
    },
    {
        question: 'Where do I pick up the car?',
        answer: `Our home base is in ${BUSINESS.city}, ${BUSINESS.region} ${BUSINESS.postalCode}. The exact pickup address is sent once your booking is confirmed.`,
    },
    {
        question: 'Do you deliver the car to me?',
        answer: `Yes. We deliver anywhere within ${DELIVERY_RADIUS_MILES} miles of our Saint Paul home base for a flat ${money(DELIVERY_FEE)} fee, which covers both drop-off and collection. Enter your address at checkout and we'll confirm whether it's in range. Picking up from our home base, the airport, and a few other locations is always free.`,
    },
    {
        question: 'Do you offer discounts for longer trips?',
        answer:
            'Yes, and they apply automatically — 5% off from 3 days, 10% off from a week, 15% from two weeks, and 20% from three weeks. Trips of 30 days or more take a further 5% off the discounted rate, for about 24% total.',
    },
    {
        question: 'Does it cost more to book a car for today?',
        answer:
            'Trips starting the same day carry a 5% surcharge, shown in the price breakdown before you pay. Booking a day ahead avoids it.',
    },
    {
        question: 'What do I need in order to book?',
        answer:
            "A valid driver's license and a credit or debit card. Your license is verified through Stripe Identity during checkout — you'll photograph the front and back and take a selfie, and it's usually confirmed within a minute.",
    },
    {
        question: 'When am I charged?',
        answer:
            'The full amount is charged when you book, through Stripe. We never see or store your card details.',
    },
]

// ─────────────────────────────────────────────────────────────────────────────
// NOT YET PUBLISHED — these need real answers from the business before they go
// on the page. Move an entry into FAQS above once its answer is confirmed;
// don't guess, since these are the terms customers will hold you to.
export const PENDING_FAQS: string[] = [
    'What is the minimum age to rent?',
    'Do I need my own insurance, or is coverage included?',
    'Is there a mileage limit?',
    'Is a security deposit required?',
    'What is the cancellation policy?',
    'What is the fuel policy?',
    'Can I add a second driver?',
    'Are pets or smoking allowed in the car?',
]

export function faqJsonLd() {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQS.map(({ question, answer }) => ({
            '@type': 'Question',
            name: question,
            acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
    }
}