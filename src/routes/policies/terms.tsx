import { createFileRoute, Link } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { BUSINESS, CONTACT_EMAIL, CONTACT_PHONE, DAILY_HOURS, seoMeta } from '@/lib/business'
import {
    DEPOSIT_PLACE_BEFORE_HOURS,
    DEPOSIT_RELEASE_AFTER_HOURS,
    formatDepositAmount,
} from '@/lib/deposit'
import { EXTENSION_REQUEST_CUTOFF_MINUTES } from '@/lib/extension'
import { MIN_LEAD_TIME_HOURS, PENDING_HOLD_MS } from '@/lib/availability'
import { MILES_INCLUDED_PER_DAY } from '@/lib/distance'
import { CHARGE_CATEGORIES } from '@/lib/charges'
import { MN_RENTAL_MOTOR_VEHICLE_TAX, SHORT_TERM_MAX_DAYS } from '@/lib/tax'
import { DELIVERY_FEE, DELIVERY_RADIUS_MILES, LISTED_PICKUP_FEE } from '@/lib/pickup'
import { EXTRAS, extraPriceLabel } from '@/lib/extras'
import { MIN_DRIVER_AGE_YEARS } from '@/lib/additional-drivers'
import { termsSection } from '@/lib/policy-sections'
import {
    DraftBanner,
    LegalReview,
    OwnerDecision,
    PolicySection as Section,
} from '@/components/policies/PolicyParts'

const formatPercent = (rate: number) => `${(rate * 100).toFixed(3).replace(/\.?0+$/, '')}%`

// ▶ DRAFT, written in full and awaiting the owners' review, and a lawyer's,
// before it takes effect. Every open point is marked on the page itself
// (OwnerDecision, LegalReview) and listed in ImportantFiles/policy-review.md.
//
// Every number is interpolated from the constant the code uses. This page is
// what the checkout agreement points to, and is what a customer will hold the
// business to: a figure typed here could disagree with what is enforced.
//
// Section numbers come from src/lib/policy-sections.ts. Cite another section
// with termsSection('deposit'), never a typed number.

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

const categoryList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })
    .format(CHARGE_CATEGORIES.filter(c => c.id !== 'other').map(c => c.label.toLowerCase()))

const money = (n: number) => `$${n.toLocaleString('en-US')}`

function SectionLink({ to, children }: { to: string; children: React.ReactNode }) {
    return <a href={`#${to}`} className="underline text-pine-500">{children}</a>
}

function TermsOfService() {
    const deposit = formatDepositAmount()
    const holdHours = PENDING_HOLD_MS / 3_600_000
    const holdLength = holdHours === 1 ? 'one hour' : `${holdHours} hours`

    return (
        <article className="max-w-2xl">
            <h2 className="text-2xl font-bold mb-2">Terms of service</h2>
            <p className="text-sm text-muted mb-4">Last revised: — (draft)</p>

            <DraftBanner>
                <p>
                    These terms are written in full but haven't been finalized. Until they are, the sections on
                    payments, deposits, extensions, extras, trip costs, changed cars, cancellations and taxes
                    describe exactly how {BUSINESS.name} works today.
                </p>
            </DraftBanner>

            <Section id="about">
                <p>
                    {BUSINESS.name} is operated by {BUSINESS.legalName}, a Minnesota company based in{' '}
                    {BUSINESS.city}, {BUSINESS.region} ("{BUSINESS.name}", "we", "us"). These terms are the agreement
                    between us and you, the person who books a car ("you"). You accept them when you tick the
                    agreement box at checkout, for that booking and everything that follows from it.
                </p>
                <p>
                    Our <Link to="/policies/cancellation" className="underline text-pine-500">cancellation policy</Link>{' '}
                    is part of these terms. Our <Link to="/policies/privacy" className="underline text-pine-500">privacy policy</Link>{' '}
                    explains what information we collect and what we do with it. If these terms and a page on our
                    site seem to say different things, these terms apply.
                </p>
            </Section>

            <Section id="eligibility">
                <p>
                    To rent a car you must be at least <OwnerDecision id="OD-MIN-AGE">minimum renter age</OwnerDecision>{' '}
                    years old and hold a valid, unexpired driver's license that lets you drive the car in
                    Minnesota. Every additional driver must be at least {MIN_DRIVER_AGE_YEARS} years old and hold a
                    valid license too. <OwnerDecision id="OD-LICENSE-RULES">whether a license must have been held
                    for a minimum time, whether foreign licenses need an International Driving Permit, and whether
                    driving-record problems disqualify a renter</OwnerDecision>.
                </p>
                <p>
                    Before you pay for your first trip, we verify your identity through Stripe Identity: you
                    photograph your driver's license and take a selfie, and Stripe checks that the license is
                    genuine and that the selfie matches its photo. Only a driver's license is accepted; a passport
                    or a state ID card isn't. You need to do this once. What is collected and kept is in our
                    privacy policy.
                </p>
                <p>
                    At pickup we may check the license of whoever is collecting the car against the verified one.
                    Additional drivers aren't verified online; we check their licenses in person. If a license is
                    missing, expired, or doesn't match, we may refuse to hand over the car.{' '}
                    <OwnerDecision id="OD-REFUSED-HANDOVER">what is refunded when we refuse to hand over the car
                    for that reason: treated as the guest cancelling, or something else</OwnerDecision>
                </p>
            </Section>

            <Section id="account">
                <p>
                    Keep your account details accurate: your legal name, date of birth, phone number, email and
                    home address. We use them to contact you about your trip, and the name and date of birth must
                    match your license. An account is for one person; don't share it or book for someone else to
                    drive alone. Keep your password private. You're responsible for bookings and requests made
                    from your account.
                </p>
            </Section>

            <Section id="booking">
                <p>
                    Trips can start at least {MIN_LEAD_TIME_HOURS} hours from the time you book. Pickups and returns
                    are between {DAILY_HOURS}, every day, at the times our booking calendar offers. The price shown
                    at checkout, including any discounts, surcharges, fees, extras and tax, is the price you pay.
                </p>
                <p>
                    Daily prices vary by date: weekends and busy periods (holidays and big local events, for
                    example) can cost more, and quieter periods less. Each day of your trip is priced for its own
                    date, and the car page and checkout show the total before you book. Once you've booked, later
                    price changes don't affect your trip.
                </p>
                <p>
                    A booking is confirmed once your payment succeeds, and we email you to say so. While you check
                    out, the car is held for you for {holdLength}. If you pay after that and someone else has booked
                    the car for any of your dates in the meantime, we can't confirm your trip: we refund your payment
                    in full straight away and email you to let you know.
                </p>
            </Section>

            <Section id="payment">
                <p>
                    When you book, you pay the trip total shown at checkout, by credit or debit card (including
                    Apple Pay and Google Pay). Payments are processed by Stripe; {BUSINESS.name} never sees or
                    stores your full card number.
                </p>
                <p>
                    By booking, you authorize {BUSINESS.legalName} to save the card you pay with and to charge it,
                    without asking you again each time, for the following, as described in these terms:
                </p>
                <ul className="list-disc pl-5 space-y-1.5">
                    <li>the security deposit hold (<SectionLink to="deposit">{termsSection('deposit')}</SectionLink>);</li>
                    <li>trip extensions you ask for (<SectionLink to="extensions">{termsSection('extensions')}</SectionLink>);</li>
                    <li>extras you ask for after booking (<SectionLink to="extras">{termsSection('extras')}</SectionLink>); and</li>
                    <li>costs arising from your trip (<SectionLink to="costs">{termsSection('costs')}</SectionLink>).</li>
                </ul>
                <p>
                    The saved card is used only for the trip you booked with it. You can replace it at any time from
                    your trip page; the new card is then used instead. We email you a receipt for every charge.
                </p>
            </Section>

            <Section id="deposit">
                <p>
                    Every trip has a refundable security deposit of <span className="font-semibold">{deposit}</span>.
                    About {DEPOSIT_PLACE_BEFORE_HOURS} hours before pickup, or straight away if you book closer to
                    pickup than that, we place a hold for this amount on your card. A hold is not a charge: the money
                    stays in your account but is unavailable to you while the hold is in place. On a debit card, that
                    means the funds are set aside from your balance.
                </p>
                <p>
                    Card holds expire on their own after a period set by the card network. On longer trips we place a
                    fresh hold before the current one expires, then release the old one; for a short time your bank
                    may show both as pending.
                </p>
                <p>
                    We release the hold once we've inspected the car after you return it, and no later than{' '}
                    {DEPOSIT_RELEASE_AFTER_HOURS} hours after you return it. Your bank may take a few days to make
                    the funds available again. If we find damage or other costs when we inspect the car, we may
                    keep the hold in place for longer while we assess them, and we'll email you if we do. If the car is
                    returned damaged, or other costs described in{' '}
                    <SectionLink to="costs">{termsSection('costs')}</SectionLink> arise, we may instead charge some or
                    all of the hold to cover them, and will tell you what for. If those costs are more than the hold,
                    the difference is charged to your card on file.
                </p>
                <p>
                    <span className="font-semibold">If the hold can't be placed</span>, for example because your card
                    is declined, we'll email you and try again, and you can add a different card from your trip page.
                    The lockbox code for the car is released once a hold is in place.
                </p>
            </Section>

            <Section id="pickup">
                <p>
                    You choose where to collect the car when you book. Picking up from our home base in{' '}
                    {BUSINESS.city} is free; we send the exact address once your booking is confirmed. Our other
                    listed pickup locations cost {money(LISTED_PICKUP_FEE)}. We deliver anywhere within{' '}
                    {DELIVERY_RADIUS_MILES} miles of our home base for {money(DELIVERY_FEE)}, which covers both the
                    drop-off and the collection. The car is returned to the same place it was collected from unless
                    we agree otherwise in writing.
                </p>
                <p>
                    The car's lockbox code is on your trip page and in your emails once your deposit hold is in place.
                    Keep it to yourself. We may change a code between trips; the code on your trip page is always the
                    current one.
                </p>
                <p>
                    Please photograph the car, inside and out, at pickup and at return, and upload the photos to your
                    trip page. We may photograph it too. Those photos are the record of the car's condition, and
                    without yours we rely on ours.
                </p>
                <p>
                    Return the car by the end time of your trip, or extend the trip first
                    (<SectionLink to="extensions">{termsSection('extensions')}</SectionLink>). A late return may be
                    charged as described in <SectionLink to="costs">{termsSection('costs')}</SectionLink>:{' '}
                    <OwnerDecision id="OD-LATE-RETURN">grace period, and the late-return rate (per hour, or a day at
                    the trip's rate)</OwnerDecision>. Return the car with the key and every accessory it came with,
                    locked, in the agreed place. If you don't return it and we can't reach you, we may report it to
                    the police as stolen.
                </p>
            </Section>

            <Section id="use">
                <p>
                    Only you and the additional drivers on your trip page may drive the car. Each driver must follow
                    these terms, and you're responsible for anything an additional driver does.
                </p>
                <LegalReview id="LR-PROHIBITED-USES" block>
                    <p>You must not, and must not let anyone else:</p>
                    <ul className="list-disc pl-5 space-y-1.5">
                        <li>drive under the influence of alcohol, cannabis or any drug that impairs driving;</li>
                        <li>race, take part in a speed test, or drive recklessly;</li>
                        <li>tow or push anything, or fit a hitch, roof rack or other equipment to the car;</li>
                        <li>drive off paved or maintained roads;</li>
                        <li>use the car for anything illegal, or carry anything illegal in it;</li>
                        <li>carry more passengers than there are seat belts, or a child without the car seat the law requires;</li>
                        <li>rent, lend or sublet the car to anyone else;</li>
                        <li>leave the car unlocked, or leave the key in or near it;</li>
                        <li>
                            carry passengers or goods for pay, or drive for a rideshare or delivery app:{' '}
                            <OwnerDecision id="OD-RIDESHARE">whether rideshare and delivery driving is allowed</OwnerDecision>;
                        </li>
                        <li>smoke or vape in the car: <OwnerDecision id="OD-SMOKING">smoking rule, and the cleaning charge if broken</OwnerDecision>;</li>
                        <li>bring an animal in the car: <OwnerDecision id="OD-PETS">pet rule (service animals are always allowed)</OwnerDecision>.</li>
                    </ul>
                </LegalReview>
                <p>
                    Where the car may go: <OwnerDecision id="OD-TRAVEL-AREA">travel area: Minnesota only, the
                    neighbouring states, anywhere in the US; and whether Canada is allowed</OwnerDecision>.
                </p>
                <p>
                    Tell us straight away if a warning light comes on or the car develops a fault, and don't keep
                    driving it if that could cause damage. Don't have the car repaired without asking us first.
                </p>
            </Section>

            <Section id="mileage-fuel">
                <p>
                    Each day of your trip includes {MILES_INCLUDED_PER_DAY} miles. Miles beyond your trip's allowance
                    are charged at the per-mile rate shown when you booked, after the trip. Days added by an extension
                    add their own allowance. With the Unlimited mileage extra, there is no allowance and no per-mile
                    charge.
                </p>
                <p>
                    Return the car with the same fuel level it had at pickup. If it comes back with less, we charge
                    for refueling: <OwnerDecision id="OD-FUEL-CHARGE">how refueling is charged (the cost of the fuel,
                    plus any service fee)</OwnerDecision>. With the Prepaid refuel extra you can return it at any fuel
                    level; it covers up to a full tank.
                </p>
            </Section>

            <Section id="tolls">
                <p>
                    You're responsible for every toll, parking charge, ticket, fine and citation incurred during your
                    trip, including any that arrive after it ends. When one is issued to us as the car's owner, we may
                    pay it and charge it to your card on file as described in{' '}
                    <SectionLink to="costs">{termsSection('costs')}</SectionLink>, or give the issuing authority your
                    name, address and license details so it is transferred to you.{' '}
                    <OwnerDecision id="OD-ADMIN-FEE">whether an administration fee is added for handling a ticket or toll, and how much</OwnerDecision>
                </p>
            </Section>

            <Section id="damage">
                <p>
                    If the car is in an accident, damaged, broken into or stolen, make sure everyone is safe, call
                    the police where the law requires it (and always for theft or an accident with another vehicle
                    or an injury), and tell us as soon as you can at {CONTACT_PHONE}. Take photos, and get the names,
                    insurance and license details of anyone else involved. Cooperate with us, the police and any
                    insurer handling the claim.
                </p>
                <LegalReview id="LR-DAMAGE-LIABILITY" block>
                    <p>
                        You're responsible for loss of or damage to the car during your trip, up to the reasonable
                        cost of repair (or the car's value if it can't be repaired), including towing and storage,
                        whoever caused it, except for normal wear and tear, and except where the law limits what a
                        renter can be charged. We charge it at the actual cost, show you what for, and may take it from
                        the deposit hold (<SectionLink to="deposit">{termsSection('deposit')}</SectionLink>) and charge
                        your card on file for the rest.
                    </p>
                    <p>
                        <OwnerDecision id="OD-LOSS-OF-USE">whether we also charge for the days the car can't be rented
                        while it's repaired (loss of use), and how that's worked out</OwnerDecision>.
                    </p>
                </LegalReview>
            </Section>

            <Section id="insurance">
                <p>
                    No protection plan is included with any trip, and {BUSINESS.name} doesn't sell one. Your own auto
                    insurance applies as it normally would.{' '}
                    <OwnerDecision id="OD-INSURANCE">whether renters must carry their own auto insurance and show
                    proof of it, and what, if anything, our own fleet insurance covers for a renter</OwnerDecision>
                </p>
                <p>
                    <LegalReview id="LR-INSURANCE">
                        Check with your insurer and your card issuer before your trip about whether they cover a car
                        rented from a small rental company, and for how much. Anything they don't cover is your
                        responsibility under{' '}
                        <SectionLink to="damage">{termsSection('damage')}</SectionLink>.
                    </LegalReview>
                </p>
            </Section>

            <Section id="extensions">
                <p>
                    You can ask to extend a trip from your trip page at any time before it ends. If the car is
                    available for the whole of the added time, the extension is confirmed immediately and charged to
                    your card on file. If you ask within {EXTENSION_REQUEST_CUTOFF_MINUTES} minutes of your trip's end,
                    it's sent to us as a request: we place a hold for the amount, and charge it only if we approve. If
                    we decline, the hold is released. A trip can't be extended once it has ended.
                </p>
                <p>
                    An extension costs the price of the days it adds, at our current daily prices for those dates
                    (weekend and busy-period prices included), with the length discount for your trip's new total length. Time added within a day you've already
                    paid for costs nothing. Extensions are on the same cancellation terms as your trip, and each added
                    day includes the usual {MILES_INCLUDED_PER_DAY}-mile allowance.
                </p>
            </Section>

            <Section id="extras">
                <p>At checkout you can add:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                    {EXTRAS.map(e => (
                        <li key={e.id}><span className="font-semibold">{e.name}</span> ({extraPriceLabel(e)}): {e.description}</li>
                    ))}
                </ul>
                <p>
                    Extras are priced at checkout and are refunded in full if the trip is cancelled. Extras you ask
                    for after booking are a request. We place a hold on your card on file for each one, charge it if
                    we approve, and release it if we don't. Unlimited mileage can only be added at checkout, and
                    requests must be made before the trip starts.
                </p>
            </Section>

            <Section id="costs">
                <p>
                    We may charge your card on file for costs your trip causes, including {categoryList}. Mileage
                    beyond your trip's allowance is charged at the per-mile rate shown when you booked. Other amounts
                    reflect the actual cost to us, and we'll tell you what each charge is for. We only make these
                    charges once your trip has started. You'll receive a receipt for every charge.
                </p>
                <p>
                    If a charge can't be made to your card on file, we'll email you a secure link to pay it.
                </p>
            </Section>

            <Section id="swap">
                <p>
                    Occasionally the car you booked can't make your trip, for example because it needs a repair.
                    Before your trip starts, we may move your booking to another car from our fleet that is available
                    for your whole trip. If we do, we'll email you the new car and the reason.
                </p>
                <p>
                    Your dates, pickup and price stay the same. We won't charge you more or refund the difference if
                    the new car's daily price is different. Mileage beyond your allowance is still charged at the
                    per-mile rate shown when you booked. If the new car's lockbox code has been released to you, the
                    email includes it. Otherwise it follows as described in{' '}
                    <SectionLink to="deposit">{termsSection('deposit')}</SectionLink>.
                </p>
                <p>
                    If the new car doesn't work for you, contact us. Cancelling follows our usual{' '}
                    <Link to="/policies/cancellation" className="underline text-pine-500">cancellation policy</Link>.
                    We don't change your car once your trip has started.
                </p>
            </Section>

            <Section id="cancellation">
                <p>
                    Cancelling and refunds are covered by our{' '}
                    <Link to="/policies/cancellation" className="underline text-pine-500">cancellation policy</Link>,
                    including what happens to extensions, extras and holds when a trip is cancelled. If we cancel your
                    trip, you're refunded in full.
                </p>
            </Section>

            <Section id="taxes">
                <p>
                    Prices on the car page are before tax. Tax is shown at checkout and on your receipt: sales tax
                    (Minnesota's plus the local sales taxes where you pick the car up, shown as one combined rate)
                    and, for rentals of {SHORT_TERM_MAX_DAYS} days or less, Minnesota's{' '}
                    {formatPercent(MN_RENTAL_MOTOR_VEHICLE_TAX.rate)} rental vehicle tax. Charges after booking are
                    taxed the same way where tax applies, and a refund returns the tax on the amount refunded.
                </p>
            </Section>

            <Section id="refusal">
                <p>
                    We may decline any booking. We may also stop an account from making new bookings, for example
                    after unpaid charges, damage, a broken rule in these terms, a disputed valid charge, or
                    information that turns out to be false. A block can apply to your driver's license as well as
                    your account, so it also applies to any other account verified with the same license.
                </p>
                <p>
                    A blocked account can still sign in, see its trips and receipts, and pay anything it owes. It can't
                    book, verify an ID, extend a trip, request extras or post a review. Blocking an account doesn't
                    cancel a confirmed trip. If we decide to cancel one, it is refunded in full, as any trip we cancel
                    is. If you think we've blocked you by mistake, contact us at {CONTACT_EMAIL}.
                </p>
                <p>
                    <LegalReview id="LR-NONDISCRIMINATION">
                        We never refuse service because of race, color, creed, religion, national origin, sex,
                        marital status, disability, public assistance status, sexual orientation, gender identity or
                        age (beyond the age rules in{' '}
                        <SectionLink to="eligibility">{termsSection('eligibility')}</SectionLink>).
                    </LegalReview>
                </p>
            </Section>

            <Section id="content">
                <p>
                    After a completed trip you can review it. Your review, its star rating and your first name are
                    shown publicly on our site. Reviews must be your honest experience, and must not include anyone's
                    personal information, abuse, or anything unlawful. We may remove a review that breaks these rules;
                    we don't remove reviews for being negative. By posting one you let us show it on our site and
                    quote it, with your first name, for as long as it stays posted.
                </p>
                <p>
                    Photos and videos you upload to a trip are seen only by you and us. We use them as the record of
                    the car's condition, including as evidence for a charge or in a dispute.
                </p>
            </Section>

            <Section id="disputes">
                <p>
                    If you have a question about any charge, contact us at {CONTACT_EMAIL} first. We'll explain it
                    and put right anything that's wrong.
                </p>
                <LegalReview id="LR-DISPUTES" block>
                    <p>
                        If you dispute a valid charge with your bank instead, we'll respond to the dispute with your
                        booking, these terms, receipts and trip photos, and we may block the account
                        (<SectionLink to="refusal">{termsSection('refusal')}</SectionLink>) while it's open.
                    </p>
                    <p>
                        These terms are governed by the laws of Minnesota. Any claim that can't be settled between
                        us is decided in the courts of{' '}
                        <OwnerDecision id="OD-VENUE">venue, e.g. Ramsey County, Minnesota; and whether disputes go
                        to arbitration instead</OwnerDecision>, except that either of us may bring a claim in
                        conciliation (small claims) court where it qualifies.
                    </p>
                </LegalReview>
            </Section>

            <Section id="liability">
                <LegalReview id="LR-LIABILITY" block>
                    <p>
                        We aren't responsible for property left in a car, or for indirect losses such as missed
                        travel, lost earnings or other plans affected by a delay or a cancelled trip. If we're
                        responsible for a loss, our liability is limited to what you paid for the trip it concerns.
                    </p>
                    <p>
                        You agree to cover us for claims, fines and costs brought against us by others because of how
                        the car was used during your trip, or because a driver broke these terms.
                    </p>
                    <p>
                        Nothing in these terms limits liability that the law doesn't allow to be limited, including
                        for death or personal injury caused by negligence, or your rights as a consumer under
                        Minnesota law.
                    </p>
                </LegalReview>
            </Section>

            <Section id="general">
                <p>
                    We may update these terms. The terms in force when you book apply to that booking; a later change
                    applies only to bookings made after it, unless the change is required by law. The date at the
                    top of this page is when they last changed.
                </p>
                <p>
                    If a court finds part of these terms unenforceable, the rest still applies. If we don't enforce a
                    term straight away, we can still enforce it later. You can't transfer your booking or these terms
                    to someone else. We send notices to the email on your account, and you can reach us at{' '}
                    {CONTACT_EMAIL} or {CONTACT_PHONE}.
                </p>
            </Section>
        </article>
    )
}
