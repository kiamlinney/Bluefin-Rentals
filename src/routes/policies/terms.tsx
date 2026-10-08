import { createFileRoute, Link } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { BUSINESS, CONTACT_EMAIL, seoMeta } from '@/lib/business'
import {
    DEPOSIT_PLACE_BEFORE_HOURS,
    DEPOSIT_RELEASE_AFTER_HOURS,
    formatDepositAmount,
} from '@/lib/deposit'
import { EXTENSION_REQUEST_CUTOFF_MINUTES } from '@/lib/extension'
import { PENDING_HOLD_MS } from '@/lib/availability'
import { MILES_INCLUDED_PER_DAY } from '@/lib/distance'
import { CHARGE_CATEGORIES } from '@/lib/charges'
import { MN_RENTAL_MOTOR_VEHICLE_TAX, SHORT_TERM_MAX_DAYS } from '@/lib/tax'

const formatPercent = (rate: number) => `${(rate * 100).toFixed(3).replace(/\.?0+$/, '')}%`

// ▶ DRAFT. The payment sections of the terms, drafted from the rules the code
// enforces (ImportantFiles/*.md) and awaiting the owners' review — ideally
// a lawyer's too — before real payments are taken. The rest of the terms
// (eligibility, insurance, conduct, liability…) is not written yet.
//
// Every number is interpolated from the constant the code uses. This page is
// what the checkout agreement points to, and is what a customer will hold the
// business to: a figure typed here could disagree with what is enforced.

export const Route = createFileRoute('/policies/terms')({
    head: () => ({
        meta: seoMeta({
            title: 'Terms of service | Bluefin Rentals',
            description: 'The terms governing your use of Bluefin Rentals.',
            path: '/policies/terms',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/policies/terms') }],
    }),
    component: TermsOfService,
})

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mb-8">
            <h3 className="text-lg font-bold mb-2">{title}</h3>
            <div className="space-y-3 text-sm leading-relaxed">{children}</div>
        </section>
    )
}

const categoryList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })
    .format(CHARGE_CATEGORIES.filter(c => c.id !== 'other').map(c => c.label.toLowerCase()))

function TermsOfService() {
    const deposit = formatDepositAmount()
    const holdHours = PENDING_HOLD_MS / 3_600_000
    const holdLength = holdHours === 1 ? 'one hour' : `${holdHours} hours`

    return (
        <article className="max-w-2xl">
            <h2 className="text-2xl font-bold mb-2">Terms of service</h2>
            <p className="text-sm text-muted mb-4">Last revised: — (draft)</p>

            <div className="mb-8 rounded-xl border border-amber-700 bg-amber-100 p-4 text-sm text-ink">
                <p className="font-bold">Draft</p>
                <p className="mt-1">
                    These terms are being prepared and are not yet final. The sections below describe how
                    payments work on {BUSINESS.name}; further sections will be added.
                </p>
            </div>

            <Section title="1. Paying for your trip">
                <p>
                    When you book, you pay the trip total shown at checkout, by credit or debit card
                    (including Apple Pay and Google Pay). Payments are processed by Stripe; {BUSINESS.name}
                    never sees or stores your full card number.
                </p>
                <p>
                    While you check out, the car is held for you for {holdLength}. If you pay after that and
                    someone else has booked the car for any of your dates in the meantime, we can't confirm
                    your trip: we refund your payment in full straight away and email you to let you know.
                </p>
            </Section>

            <Section title="2. Your card on file">
                <p>
                    By booking, you authorize {BUSINESS.legalName} to save the card you pay with and to charge
                    it, without asking you again each time, for the following, as described in these terms:
                </p>
                <ul className="list-disc pl-5 space-y-1.5">
                    <li>the security deposit hold (section 3);</li>
                    <li>trip extensions you ask for (section 4);</li>
                    <li>extras you ask for after booking (section 5); and</li>
                    <li>costs arising from your trip (section 6).</li>
                </ul>
                <p>
                    The saved card is used only for the trip you booked with it. You can replace it at any
                    time from your trip page; the new card is then used instead. We email you a receipt for
                    every charge.
                </p>
            </Section>

            <Section title="3. Security deposit">
                <p>
                    Every trip has a refundable security deposit of <span className="font-semibold">{deposit}</span>.
                    About {DEPOSIT_PLACE_BEFORE_HOURS} hours before pickup — or straight away if you book closer to
                    pickup than that — we place a hold for this amount on your card. A hold is not a charge:
                    the money stays in your account but is unavailable to you while the hold is in place.
                    On a debit card, that means the funds are set aside from your balance.
                </p>
                <p>
                    Card holds expire on their own after a period set by the card network. On longer trips we
                    place a fresh hold before the current one expires, then release the old one; for a short
                    time your bank may show both as pending.
                </p>
                <p>
                    The hold is released {DEPOSIT_RELEASE_AFTER_HOURS} hours after you return the car. If the car
                    is returned damaged, or other costs described in section 6 arise, we may instead charge
                    some or all of the hold to cover them, and will tell you what for. If those costs are more
                    than the hold, the difference is charged to your card on file.
                </p>
                <p>
                    <span className="font-semibold">If the hold can't be placed</span> — for example, your card is
                    declined — we'll email you and try again, and you can add a different card from your
                    trip page. The lockbox code for the car is released once a hold is in place.
                </p>
            </Section>

            <Section title="4. Extending your trip">
                <p>
                    You can ask to extend a trip from your trip page at any time before it ends. If the car is
                    available for the whole of the added time, the extension is confirmed immediately and
                    charged to your card on file. If you ask within {EXTENSION_REQUEST_CUTOFF_MINUTES} minutes of
                    your trip's end, it's sent to us as a request: we place a hold for the amount, and charge
                    it only if we approve. If we decline, the hold is released. A trip can't be extended once
                    it has ended.
                </p>
                <p>
                    An extension costs the price of the days it adds, at our current daily prices for those
                    dates, with the length discount for your trip's new total length. Time added within a day
                    you've already paid for costs nothing. Extensions are on the same cancellation terms as
                    your trip, and each added day includes the usual {MILES_INCLUDED_PER_DAY}-mile allowance.
                </p>
            </Section>

            <Section title="5. Extras added after booking">
                <p>
                    Extras you ask for after booking are a request. We place a hold on your card on file for
                    each one, charge it if we approve, and release it if we don't.
                </p>
            </Section>

            <Section title="6. Costs arising from your trip">
                <p>
                    We may charge your card on file for costs your trip causes, including {categoryList}.
                    Mileage beyond your trip's allowance is charged at the per-mile rate shown when you
                    booked. Other amounts reflect the actual cost to us, and we'll tell you what each charge
                    is for. You'll receive a receipt for every charge.
                </p>
                <p>
                    If a charge can't be made to your card on file, we'll email you a secure link to pay it.
                </p>
            </Section>

            <Section title="7. If we change your car">
                <p>
                    Occasionally the car you booked can't make your trip, for example because it needs a
                    repair. Before your trip starts, we may move your booking to another car from our fleet
                    that is available for your whole trip. If we do, we'll email you the new car and the
                    reason.
                </p>
                <p>
                    Your dates, pickup and price stay the same. We won't charge you more or refund the
                    difference if the new car's daily price is different. Mileage beyond your allowance is
                    still charged at the per-mile rate shown when you booked. If the new car's lockbox code
                    has been released to you, the email includes it. Otherwise it follows as described in
                    section 3.
                </p>
                <p>
                    If the new car doesn't work for you, contact us. Cancelling follows our usual{' '}
                    <Link to="/policies/cancellation" className="underline text-pine-500">cancellation policy</Link>.
                    We don't change your car once your trip has started.
                </p>
            </Section>

            <Section title="8. Cancellations and refunds">
                <p>
                    Cancelling and refunds are covered by our{' '}
                    <Link to="/policies/cancellation" className="underline text-pine-500">cancellation policy</Link>,
                    including what happens to extensions, extras and holds when a trip is cancelled.
                </p>
            </Section>

            <Section title="9. Taxes">
                <p>
                    Prices on the car page are before tax. Tax is shown at checkout and on your receipt:
                    sales tax (Minnesota's plus the local sales taxes where you pick the car up, shown as
                    one combined rate) and, for rentals of{' '}
                    {SHORT_TERM_MAX_DAYS} days or less, Minnesota's {formatPercent(MN_RENTAL_MOTOR_VEHICLE_TAX.rate)}{' '}
                    rental vehicle tax. Charges after booking are taxed the same way where tax applies, and a
                    refund returns the tax on the amount refunded.
                </p>
            </Section>

            <Section title="10. Questions and disputes">
                <p>
                    If you have a question about any charge, contact us at {CONTACT_EMAIL} first — we'll
                    explain it and put right anything that's wrong.
                </p>
            </Section>
        </article>
    )
}