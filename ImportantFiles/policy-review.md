# Policy review: terms of service and privacy policy

The terms (`/policies/terms`) and the privacy policy (`/policies/privacy`) were written in full on
2026-10-12. They are **drafts**: both pages say so in a banner, and every open point is marked
on the page itself:

- **Owner decision** (amber, `OD-…`). A business rule nobody has decided yet. Nothing is guessed;
  the page shows a visible placeholder instead.
- **Legal review** (violet, `LR-…`). Wording that is drafted but needs a lawyer.

This document lists every marker: where it is, the facts behind it, and a suggested answer.
`tests/policy-review.test.ts` fails if a page and the tables below disagree about which ids are
open. To resolve one:

1. Replace the marker on the page with the decided wording.
2. Move its row to **Resolved** with the date and the answer.
3. Add a row to `decisions-log.md`.
4. If it's a number the code uses, add a constant and interpolate it, as the payment sections do.

What the drafts state as settled is what the code enforces today: payments, the deposit,
extensions, extras, trip costs, changed cars, cancellations, taxes, blocking and verification.
Those are numbered sections that interpolate the constants
(`src/lib/policy-sections.ts#TERMS_SECTIONS`).

## Owner decisions (open)

| ID | Page, section | The question | What exists today | Suggested default |
|---|---|---|---|---|
| `OD-MIN-AGE` | Terms, Who can rent | Minimum age of the main renter. | Additional drivers must be at least `src/lib/additional-drivers.ts#MIN_DRIVER_AGE_YEARS` (21). Nothing checks the renter's age. The licence DOB is now captured (`customer_identities.dob`), so it could be enforced at checkout. | 21, the same as additional drivers; enforce it in `createCheckoutSession` once decided. |
| `OD-LICENSE-RULES` | Terms, Who can rent | Minimum years licensed? Foreign licences, and whether an International Driving Permit is needed? Disqualifying driving records? | Stripe Identity accepts a driver's licence only (decided 2026-10-13, see Resolved). Nothing checks years licensed or the issuing country. | 1+ year licensed (the licence's issue date is in the CRM); foreign licences accepted with an IDP if not in English. |
| `OD-REFUSED-HANDOVER` | Terms, Who can rent | When we refuse to hand over a car (no licence, mismatch), what is refunded? | No code path. An owner would cancel from the reservation page, which refunds in full as a business cancellation. | Treat as the guest cancelling (cancellation policy applies), so a no-show with a bad licence isn't a free cancel. |
| `OD-LATE-RETURN` | Terms, Pickup and return | Grace period and late rate. | `late-return` is a charge category (`src/lib/charges.ts#CHARGE_CATEGORIES`); the amount is typed by an owner each time. | 30 minutes' grace, then the hourly share of the trip's daily rate, capped at one day per day late. |
| `OD-RIDESHARE` | Terms, Using the car | Uber/Lyft/DoorDash driving allowed? | Nothing. Personal auto policies usually exclude it. | Not allowed. |
| `OD-SMOKING` | Terms, Using the car | Smoking/vaping rule, and the cleaning charge. | `cleaning` charge category, owner-typed amount. | Not allowed; actual cleaning cost, minimum $[owner's number]. |
| `OD-PETS` | Terms, Using the car | Pets allowed? | Nothing. | Allowed in a carrier, or not at all; cleaning charged at cost if needed. Service animals are always allowed. |
| `OD-TRAVEL-AREA` | Terms, Using the car | Where can the car go? Out of state, Canada? | Nothing. | The continental US; no Canada or Mexico without written permission. |
| `OD-FUEL-CHARGE` | Terms, Mileage and fuel | How refueling is charged when not prepaid. | The Prepaid refuel extra (`src/lib/extras.ts#EXTRAS`) says it skips "the refueling fee", so a fee is implied but not defined; `fuel` charge category, owner-typed. | Cost of the fuel at the local price plus a flat service fee. |
| `OD-ADMIN-FEE` | Terms, Tolls and tickets | Fee for handling a toll or ticket? | Nothing. | $[owner's number] per item, or none. |
| `OD-LOSS-OF-USE` | Terms, Accidents and damage | Charge for days the car is off the road being repaired? | Nothing. Also see `LR-DAMAGE-LIABILITY`. | Only with a lawyer's OK; Minnesota limits it (see below). |
| `OD-INSURANCE` | Terms, Insurance | Must renters carry their own insurance and show proof? What does our fleet policy cover for a renter? | The trip page already says: "No protection plan is included with this trip. Your own auto insurance applies as it normally would." | Ask the business's insurer first. This is the biggest gap in the terms. |
| `OD-VENUE` | Terms, Disputes | Which court, and arbitration or not? | Nothing. | Ramsey County, Minnesota; no arbitration (simpler for a small business; conciliation court is cheap). |
| `OD-COLLECTIONS` | Privacy, Who we share it with | May unpaid charges go to a collection agency? | Unpaid charges stay on the pay link (`requires_payment`). | Say yes, so the option exists. |
| `OD-RETENTION-FINANCIAL` | Privacy, How long we keep it | Years to keep bookings, payments and receipts. | Bookings are never deleted (CLAUDE.md, "Money is a legal record"). | 7 years. The IRS generally needs 3, but 6–7 in some cases; Minnesota sales tax records need 3½. |
| `OD-RETENTION-ID` | Privacy, How long we keep it | How long licence details are kept after the last trip or account closure. | `customer_identities` is kept until the profile is deleted (`on delete cascade`). | 3 years after the last trip, matching the time a damage or toll claim can arrive. |
| `OD-RETENTION-MEDIA` | Privacy, How long we keep it | How long trip photos and videos are kept. | Kept forever today; deleted only with the booking. | 1 year after the trip, longer while a claim or dispute is open. Needs a cleanup job once decided. |

## Legal review (open)

For a Minnesota lawyer. Statute pointers are leads to check, not conclusions.

| ID | Page, section | What to check |
|---|---|---|
| `LR-PROHIBITED-USES` | Terms, Using the car | Standard prohibited-use list, drafted. Confirm it, and how a breach affects the renter's liability and any insurance. |
| `LR-DAMAGE-LIABILITY` | Terms, Accidents and damage | The renter's liability for damage "whoever caused it", charged at actual cost. Check against Minn. Stat. § 65B.49, subd. 5a (rented vehicles: what a renter's own policy covers, and limits on what a rental company can charge, including loss of use). |
| `LR-INSURANCE` | Terms, Insurance | Advice to check one's own insurer and card. Confirm against the business's own commercial policy and any statutory primary-coverage rules for rental vehicles. |
| `LR-NONDISCRIMINATION` | Terms, Refusing service | The protected classes are drafted from the Minnesota Human Rights Act; confirm the list matches § 363A.11 (public accommodations), and whether age belongs on it. |
| `LR-DISPUTES` | Terms, Disputes | Chargeback language, governing law, venue; conciliation court's limit (check the current figure). |
| `LR-LIABILITY` | Terms, Limits of liability | The exclusion of indirect losses, the cap at the trip price, the indemnity, and the carve-out for what can't be limited. Check enforceability for consumers in Minnesota. |
| `LR-BIOMETRIC` | Privacy, Identity verification (and the checkout ID step's notice) | Stripe Identity compares a selfie with the licence photo, which is biometric processing. Check notice and consent wording. Stripe shows its own consent screen. Check Illinois BIPA (740 ILCS 14) and Texas/Washington biometric laws for out-of-state renters, and who counts as the collector (us or Stripe). |
| `LR-STATE-PRIVACY` | Privacy, Your rights | Does the Minnesota Consumer Data Privacy Act (Minn. Stat. ch. 325M, in force since 31 July 2025) apply? It has volume thresholds and a small-business exemption, which very likely covers us, but the exemption has an exception for selling sensitive data (we don't). Also CCPA for California visitors (threshold-based; very likely not). |
| `LR-RESPONSE-TIME` | Privacy, Your rights | 45 days to answer a request, the MCDPA's period. Keep it as a promise even if exempt? |

## Drafted commitments to confirm

These aren't marked on the pages because they describe what the code does, or are ordinary
promises. They are still promises a customer can hold us to, so read them once:

- **Terms, Who we are:** if the terms and another page disagree, the terms win. The terms are
  accepted only at checkout (the agreement box). Sign-up shows no terms notice, so an account
  that never books has agreed to nothing; add a line under the sign-up button if that matters.
- **Terms, Pickup:** the car is returned where it was collected; a car not returned and
  unreachable may be reported stolen.
- **Terms, Using the car:** no repairs without asking first.
- **Terms, Refusing service:** examples of why we block (unpaid charges, damage, broken rules,
  disputing a valid charge, false information).
- **Terms, Reviews:** we don't remove reviews for being negative.
- **Terms, Changes:** a change applies only to bookings made after it.
- **Privacy, Changes:** account holders are emailed before a change to how existing data is used.
- **Privacy, Security:** customers are told of a breach "as the law requires" (Minn. Stat. § 325E.61
  covers a name together with a driver's licence number, which we now hold).
- **Privacy, Deletion:** what is kept after an account is deleted (financial records, open claims,
  block records). Deleting an account is a manual job today; there is no button.

## Facts the privacy policy depends on

The policy is only true while these hold. Change one and the page changes with it:

- No analytics, ad pixels or cross-site trackers anywhere in `src/` (checked 2026-10-12).
- Photos are re-encoded in the browser (`src/lib/trip-media.ts`), which strips EXIF including
  GPS. **Videos are uploaded untouched** and keep their metadata.
- ID photos and selfies are never copied to our storage; the CRM shows them through 30-second
  Stripe FileLinks (`src/lib/identity.server.ts#identityImageLinks`).
- Licence details live in `customer_identities` (service role only), excluded from the CRM's
  CSV export.
- Supabase project region: `us-east-2` (Ohio). Railway logs kept 7 days (Hobby).
- The contact form is emailed, not stored (`src/lib/contact.ts#submitContactMessage`).
- Reviews show the first name only (`src/lib/db.ts#createReview` writes `reviewer_name` from
  `firstName`).

## Resolved

| ID | Date | Decision |
|---|---|---|
| Part of `OD-LICENSE-RULES` | 2026-10-13 | Only a driver's licence is accepted for ID verification; ID cards and passports aren't (Liam: "yes, only accept driver's licenses"). Stated in the terms, Who can rent. → `src/lib/db.ts#IDENTITY_DOCUMENT_TYPES` |
