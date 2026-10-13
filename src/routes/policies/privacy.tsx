import { createFileRoute, Link } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'
import { BUSINESS, CONTACT_EMAIL, CONTACT_PHONE, seoMeta } from '@/lib/business'
import { DraftBanner, LegalReview, OwnerDecision, PlainSection as Section } from '@/components/policies/PolicyParts'

// ▶ DRAFT, written in full and awaiting the owners' review, and a lawyer's.
// Open points are marked on the page (OwnerDecision, LegalReview) and listed in
// ImportantFiles/policy-review.md.
//
// Every statement here describes what the code actually does, checked against
// it on 2026-10-12. When the code starts collecting, keeping or sharing
// something new (a new table, a new third-party service, analytics, marketing
// email), this page changes in the same piece of work:
//   - accounts and profiles      src/lib/auth.ts, profiles, DriverInfoStep
//   - ID verification            src/lib/identity.server.ts, customer_identities
//   - payments                   Stripe; bookings, booking_charges
//   - trips, drivers, media      bookings, booking_additional_drivers, trip_media
//   - geocoding                  src/lib/geocode.ts (Mapbox)
//   - email                      src/lib/email.ts (Gmail), src/lib/contact.ts
//   - owners' records            customer_notes, customer_tags, customer_blocks
//   - fonts                      Google Fonts, src/routes/__root.tsx
//   - no analytics or ad pixels  (none in src/ as of this date)

export const Route = createFileRoute('/policies/privacy')({
    head: () => ({
        meta: seoMeta({
            title: 'Privacy policy | Bluefin Rentals',
            description: 'What data Bluefin Rentals collects and how it is used.',
            path: '/policies/privacy',
        }),
        links: [{ rel: 'canonical', href: absoluteUrl('/policies/privacy') }],
    }),
    component: PrivacyPolicy,
})

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-pine-500">{children}</a>
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h4 className="font-semibold">{title}</h4>
            <div className="mt-1 space-y-2">{children}</div>
        </div>
    )
}

function PrivacyPolicy() {
    return (
        <article className="max-w-2xl">
            <h2 className="text-2xl font-bold mb-2">Privacy policy</h2>
            <p className="text-sm text-muted mb-4">Last revised: — (draft)</p>

            <DraftBanner>
                <p>
                    This policy is written in full but hasn't been finalized. What it says we collect, keep and share
                    describes how {BUSINESS.name} works today.
                </p>
            </DraftBanner>

            <Section id="who" title="1. Who we are">
                <p>
                    {BUSINESS.name} is operated by {BUSINESS.legalName}, of {BUSINESS.city}, {BUSINESS.region}. We
                    decide what information is collected through this site and how it's used. Questions about it, or
                    requests about your information, go to {CONTACT_EMAIL} or {CONTACT_PHONE}.
                </p>
            </Section>

            <Section id="collect" title="2. What we collect">
                <Sub title="Your account">
                    <p>
                        Your email address and a password. The password is stored by our authentication provider
                        only in a scrambled (hashed) form; nobody at {BUSINESS.name} can see it.
                    </p>
                </Sub>
                <Sub title="Your driver details">
                    <p>
                        When you first check out: your full legal name, date of birth, mobile number, email and home
                        address. You can change these on your profile.
                    </p>
                </Sub>
                <Sub title="Identity verification">
                    <p>
                        Before your first trip you verify your identity through Stripe Identity, which is described in
                        full in <a href="#identity" className="underline text-pine-500">section 3</a>.
                    </p>
                </Sub>
                <Sub title="Payments">
                    <p>
                        Card payments are handled by Stripe. Your full card number goes to Stripe, never to us. From
                        Stripe we keep a customer reference for you, the card's brand and last four digits, and a
                        record of every payment, hold, refund and dispute on your trips. Your card is saved with
                        Stripe for the uses our{' '}
                        <Link to="/policies/terms" className="underline text-pine-500">terms</Link> describe. At checkout
                        Stripe may also offer to save your details in its own Link service; that is between you and
                        Stripe, under Stripe's terms.
                    </p>
                </Sub>
                <Sub title="Your trips">
                    <p>
                        The car, dates and times, price and its breakdown, extras, extensions, any change of car, and
                        where you pick up. If you ask for delivery, the address you type is sent to Mapbox to find it
                        on the map and check it's within our delivery area.
                    </p>
                </Sub>
                <Sub title="Additional drivers">
                    <p>
                        If you add a driver to a trip, their name, email address and date of birth. Only add someone
                        who has agreed to you giving us these.
                    </p>
                </Sub>
                <Sub title="Photos and videos of the car">
                    <p>
                        Photos and videos you or we upload to a trip, as the record of the car's condition. Photos are
                        resized in your browser before upload, which removes the hidden data a camera stores in them,
                        including location. <strong>Videos are uploaded as they are</strong>, and may still contain
                        the time, the device and the location they were recorded. Only you and we can see a trip's
                        photos and videos.
                    </p>
                </Sub>
                <Sub title="Reviews">
                    <p>
                        A review you post is shown publicly with its rating and your first name. Your full name, email
                        and which trip it was for are not shown.
                    </p>
                </Sub>
                <Sub title="Messages">
                    <p>
                        If you use our contact form, your name, email and message are emailed to our inbox; the site
                        doesn't store them. Emails you send us, and the emails we send you about your bookings, are
                        kept in our email account.
                    </p>
                </Sub>
                <Sub title="Our own records about you">
                    <p>
                        We keep private notes and tags on customer accounts (for example, that a car was returned late
                        or a guest is a regular), and a record of any account or license we've blocked from booking
                        and why. You don't see these on the site, but you can ask for them (
                        <a href="#rights" className="underline text-pine-500">section 9</a>).
                    </p>
                </Sub>
            </Section>

            <Section id="identity" title="3. Identity verification, and your driver's license">
                <p>
                    Renting a car requires a valid license, so before your first trip you verify your identity through
                    Stripe Identity, a service of Stripe, Inc. You photograph the front and back of your license and
                    take a selfie. Stripe checks that the license is genuine and{' '}
                    <LegalReview id="LR-BIOMETRIC">
                        compares your selfie with the photo on your license using facial recognition. That
                        comparison is done by Stripe, not by us, and Stripe asks for your consent before it starts.
                    </LegalReview>{' '}
                    How Stripe handles it is in{' '}
                    <Ext href="https://stripe.com/privacy">Stripe's privacy policy</Ext>.
                </p>
                <p>
                    <strong>Stripe keeps the photos and the selfie.</strong> We can view them through Stripe while
                    reviewing a booking or a claim, but we don't download or store them ourselves.
                </p>
                <p>
                    <strong>From the verification, we keep:</strong> your name as it appears on the license, date of
                    birth, license number, the state and country that issued it, its issue and expiry dates, the
                    address on it, and when it was verified. We use these to confirm you can rent, to check the
                    license at pickup, to deal with accidents, damage, tolls and tickets, and to stop someone we've
                    blocked from booking again under a new account.
                </p>
                <p>
                    These details are held in a part of our database that can only be read by our server and shown to
                    the owners of {BUSINESS.name}. They aren't included when we export customer lists.
                </p>
            </Section>

            <Section id="automatic" title="4. What's collected automatically">
                <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                        <strong>Sign-in cookies.</strong> When you sign in, cookies keep you signed in. They're
                        necessary for the site to work and aren't used for anything else.
                    </li>
                    <li>
                        <strong>Your browser's own storage</strong> remembers a contact-form message you haven't sent
                        yet, until you close the tab.
                    </li>
                    <li>
                        <strong>Stripe</strong> runs on the checkout and payment pages, and collects information about
                        your device and browser to prevent fraud, under Stripe's privacy policy.
                    </li>
                    <li>
                        <strong>Google Fonts.</strong> The site's typeface is loaded from Google, which receives your
                        IP address and browser details when it does.
                    </li>
                    <li>
                        <strong>Server logs.</strong> Our hosting provider records each request to the site, including
                        your IP address, browser and the page asked for. The logs are kept for 7 days.
                    </li>
                </ul>
                <p>
                    We don't use analytics, advertising cookies, tracking pixels or anything that follows you across
                    other sites.
                </p>
            </Section>

            <Section id="use" title="5. How we use it">
                <ul className="list-disc pl-5 space-y-1.5">
                    <li>to take and manage your bookings, pickups, returns, extensions and extras;</li>
                    <li>to check you're eligible to rent, and to verify your license;</li>
                    <li>to take payments, place and release deposit holds, charge for costs your trip causes, and give refunds;</li>
                    <li>to email you about your bookings: confirmations, arrival instructions, receipts and changes;</li>
                    <li>to deal with accidents, damage, insurance claims, tolls, tickets and citations;</li>
                    <li>to prevent fraud and misuse, including blocking accounts and licenses from booking;</li>
                    <li>to answer your questions and resolve disputes, including chargebacks;</li>
                    <li>to keep business, tax and accounting records the law requires; and</li>
                    <li>to keep the site working and secure.</li>
                </ul>
                <p>
                    We don't send marketing emails, and we don't sell your information or use it for targeted
                    advertising.
                </p>
            </Section>

            <Section id="share" title="6. Who we share it with">
                <p>Only these, and only what each needs:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                    <li><strong>Stripe</strong>: payments, saved cards and identity verification.</li>
                    <li><strong>Supabase</strong>: our database, sign-in and file storage (including trip photos).</li>
                    <li><strong>Railway</strong>: hosts the site.</li>
                    <li><strong>Google</strong>: our email (Gmail) and the site's fonts.</li>
                    <li><strong>Mapbox</strong>: finds delivery addresses on the map.</li>
                    <li>
                        <strong>Toll agencies, police and courts</strong>, when a toll, ticket or citation from your trip
                        is transferred to you, or as the law requires.
                    </li>
                    <li><strong>Insurers and their adjusters</strong>, after an accident or damage on your trip.</li>
                    <li><strong>Police</strong>, if a car isn't returned or is stolen.</li>
                    <li>
                        <OwnerDecision id="OD-COLLECTIONS">whether unpaid charges may be passed to a collection
                        agency</OwnerDecision>
                    </li>
                    <li>
                        <strong>Anyone who buys the business</strong>, who would then be bound by this policy for the
                        information they receive.
                    </li>
                </ul>
            </Section>

            <Section id="retention" title="7. How long we keep it">
                <ul className="list-disc pl-5 space-y-1.5">
                    <li>
                        <strong>Bookings, payments and receipts</strong>: they're financial records, kept for{' '}
                        <OwnerDecision id="OD-RETENTION-FINANCIAL">number of years, at least what tax law requires</OwnerDecision>.
                    </li>
                    <li>
                        <strong>License details from verification</strong>: while your account is open, and{' '}
                        <OwnerDecision id="OD-RETENTION-ID">how long after your last trip or after you close your account</OwnerDecision>.
                    </li>
                    <li>
                        <strong>Records of a blocked account or license</strong>: for as long as we need them to prevent
                        fraud, even if the account is closed. That is what makes a block work.
                    </li>
                    <li>
                        <strong>Trip photos and videos</strong>:{' '}
                        <OwnerDecision id="OD-RETENTION-MEDIA">how long after a trip, and longer while a claim or dispute is open</OwnerDecision>.
                    </li>
                    <li><strong>ID photos and selfies</strong>: held by Stripe under its own retention rules; we can ask Stripe to delete them.</li>
                    <li><strong>Server logs</strong>: 7 days.</li>
                </ul>
            </Section>

            <Section id="security" title="8. How we protect it">
                <p>
                    The site is served only over an encrypted connection. Each customer can read only their own
                    bookings and details; the database enforces this, not just the pages. License details, block
                    records and our notes are in tables only our server can read, and only the owners can open them,
                    through pages that check who's asking every time. We never hold your full card number or your ID
                    photos.
                </p>
                <p>
                    No system is perfectly secure. If your information is involved in a data breach, we'll tell you
                    as the law requires.
                </p>
            </Section>

            <Section id="rights" title="9. Your choices and rights">
                <p>
                    You can see and change your contact details on your profile at any time. Email us at{' '}
                    {CONTACT_EMAIL} to:
                </p>
                <ul className="list-disc pl-5 space-y-1.5">
                    <li>get a copy of the information we hold about you;</li>
                    <li>correct something that's wrong; or</li>
                    <li>close your account and delete your information.</li>
                </ul>
                <p>
                    <LegalReview id="LR-RESPONSE-TIME">We'll answer within 45 days.</LegalReview> We confirm a request comes from you by replying to the email address
                    on your account. When we delete an account we keep what the law requires us to (payment and tax
                    records), what we need for an open claim or dispute, and any record of a block. We'll tell you what
                    we kept and why.
                </p>
                <p>
                    <LegalReview id="LR-STATE-PRIVACY">
                        Depending on where you live, privacy laws (such as the Minnesota Consumer Data Privacy Act)
                        may give you further rights, including the right to appeal if we turn down a request. We won't
                        treat you differently for using any of these rights.
                    </LegalReview>
                </p>
            </Section>

            <Section id="children" title="10. Children">
                <p>
                    This site is for adults who can rent a car. It isn't meant for children, and we don't knowingly
                    collect information from anyone under 18. If you think a child has given us information, contact
                    us and we'll delete it.
                </p>
            </Section>

            <Section id="where" title="11. Where your information is kept">
                <p>
                    Our database and file storage are in the United States (Ohio). The other services in{' '}
                    <a href="#share" className="underline text-pine-500">section 6</a> are US companies and may
                    process information in other countries under their own safeguards.
                </p>
            </Section>

            <Section id="changes" title="12. Changes to this policy">
                <p>
                    When we change this policy we update it here and change the date at the top. If a change affects
                    how we use information we already hold, we'll email account holders before it takes effect.
                </p>
            </Section>

            <Section id="contact" title="13. Contact">
                <p>
                    {BUSINESS.legalName}, {BUSINESS.city}, {BUSINESS.region}. {CONTACT_EMAIL}, {CONTACT_PHONE}.
                </p>
            </Section>
        </article>
    )
}
