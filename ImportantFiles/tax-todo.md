# Tax: open questions for the accountant

*Prepared 2026-10-08 for Bluefin Rentals LLC's first review with an accountant.*

These are the decisions in the booking system that need professional confirmation before
the business collects tax from real customers. [tax.md](tax.md) describes how tax is
calculated today and cites the sources behind each figure. Each item below gives the
question, what the system does now, and why we aren't sure. A final line marks what changes
in the code if the answer differs. That line is for the developer and can be skipped in the
meeting.

Online bookings are paused, so **no tax has yet been collected from a real customer.**
Every assumption can still be changed without correcting a past return.

*This document records our own reading of public guidance. It is not tax advice.*

---

## Summary

| # | Topic | What we do now | Needed before launch? |
|---|---|---|---|
| 1 | Sales tax permit and registration | Not registered | **Yes** |
| 2 | 5% Motor Vehicle Rental Fee exemption | Not charged (assumed exempt) | **Yes** |
| 3 | Local rates and sourcing (Minneapolis, MSP, deliveries) | Saint Paul confirmed; others are our reading; deliveries taxed at Saint Paul rates | **Yes** |
| 4 | Which charges are taxable, including kept cancellation fees | Almost everything taxed; tolls and damage not | **Yes** |
| 5 | Rentals booked for more than 28 days | Sales tax only, no rental tax | **Yes** |
| 6 | Turo history and the period before registration | Not reviewed | Before or soon after |
| 7 | Filing, reporting and records | Report built; conventions assumed | Before the first return |
| 8 | Related questions: fleet and equipment purchases | Not reviewed | When convenient |

---

## 1. Sales tax permit and registration

**Current position.** Bluefin Rentals LLC is not registered to collect Minnesota sales tax.
On Turo, Turo collected the tax. Direct bookings at rentbluefin.com make Bluefin the
collector.

**Questions:**
- [ ] Please register the LLC (or confirm what it needs) for Minnesota sales and use tax,
  including the **Motor Vehicle Rental Tax**. The Department says to report the rental tax
  on the "Car Rentals" line of the sales tax return.
- [ ] Does that registration also cover the **local** sales taxes (Saint Paul, Ramsey
  County transit, Metro Area, Hennepin County, Minneapolis)? Or do any of them need a
  separate registration?
- [ ] What **filing frequency** will the Department assign (monthly, quarterly or annual)?

**What we'll need from the business:** the EIN, Secretary of State filing, owners' details,
the home base address, and the expected start date for collecting tax.

**References:** [Sales and Use Tax](https://www.revenue.state.mn.us/sales-and-use-tax) ·
[Short-Term Rentals](https://www.revenue.state.mn.us/guide/short-term-rentals-0) ·
[Local Sales and Use Taxes](https://www.revenue.state.mn.us/guide/local-sales-and-use-tax-guide)

*Code: nothing to change.*

## 2. The 5% Motor Vehicle Rental Fee exemption

**Current position.** We don't charge the 5% fee. A lessor is exempt if, in the **prior
calendar year**, it had **no more than 20 vehicles available for rent**, or **$50,000 or
less in gross receipts subject to the fee**. Bluefin lists 9 vehicles today. Its rentals so
far have been through Turo.

**Questions:**
- [ ] Does Bluefin qualify for the exemption for 2026, and for 2027?
- [ ] Do vehicles listed on Turo, and Turo-booked receipts, count toward the 20-vehicle and
  $50,000 tests?
- [ ] Does the exemption apply automatically, or must it be claimed?
- [ ] If Bluefin ever stops qualifying: the fee is reported once a year, less the
  registration taxes paid on the rental vehicles. How should we track those registration
  taxes?

*Code: set `RENTAL_FEE_APPLIES` in `src/lib/tax.ts` to `true` if not exempt. This test is
re-run every January.*

## 3. Local rates, and where a rental is taxed

**Current position.** A rental is taxed at the rates of the place where the customer
receives the car. Minnesota sources a rental like a retail sale
([§ 297A.668](https://www.revisor.mn.gov/statutes/cite/297A.668) subd. 4(b) and 2).
Rates come from the Department's Q4 2026 rate guide. tax.md section 4 has the breakdown.

| Pickup | What we charge (sales tax only) | Confidence |
|---|---|---|
| Home base, 2033 Sargent Ave, Saint Paul 55105 | 9.875% | Confirmed from the rate guide |
| The Grand Hotel, 615 2nd Ave S, Minneapolis 55402 | 9.025% | The rate guide's row did not read cleanly |
| MSP Airport and the MSP light rail station (Fort Snelling) | 8.525% | The airport has its own row in the guide |
| Delivery to the customer's address (up to 10 miles from home base) | 9.875%, the home base rate | Probably wrong (below) |

**Questions:**
- [ ] Are the Minneapolis and MSP rates right?
- [ ] Does a rental handed over **at MSP Airport** carry any additional tax or airport fee?
  Separately, does handing cars over there require a Metropolitan Airports Commission permit?
  That is not a tax question, but it would affect the price.
- [ ] **Deliveries.** § 297A.668 subd. 2(c) sources a delivered sale to where the customer
  receives it. Should a delivered car be taxed at the **delivery address's** rates? (We
  charge the home base's rates now.) If yes, the system needs an address-to-rate lookup.
  Delivery addresses are within 10 miles of Saint Paul, so several cities' rates can apply.
- [ ] Is it acceptable to keep a later charge (extension, damage, etc.) at the **trip's
  pickup** jurisdiction, wherever the car is returned?

*Code: `TAX_JURISDICTIONS` and `taxJurisdictionForPickup` in `src/lib/tax.ts`. Local rates
change on Jan 1, Apr 1, Jul 1 and Oct 1, so they are re-checked against each quarter's
[rate guide](https://www.revenue.state.mn.us/rate-charts-sales-tax).*

## 4. Which charges are taxable

**Current position.** Revenue Notice #06-08 includes "mandatory charges" and charges
"necessary to complete the transaction" in the base. It does not list specific charges, and
it does not mention fuel, cleaning, optional equipment or charges made after the trip.
tax.md section 5 gives our reasoning for each.

For each charge below: is it part of the taxable sales price, for sales tax **and** for the
9.2% rental tax?

| | Charge | We charge tax? | Specific doubt |
|---|---|---|---|
| [ ] | Same-day booking surcharge (5%) | Yes | — |
| [ ] | Refundable-rate premium (10% for free cancellation) | Yes | Is it rental price, or a separate optional service? |
| [ ] | Pickup-location fee ($100) and delivery fee ($120) | Yes | Optional for the customer, since home-base pickup is free |
| [ ] | Prepaid refuel ($70/trip) | Yes | **Motor fuel is generally exempt from sales tax** |
| [ ] | Fuel charge after the trip | Yes | Same as above |
| [ ] | Unlimited mileage ($80/day) | Yes | — |
| [ ] | Mileage overage (per mile) | Yes | — |
| [ ] | Child seat ($25/trip) | Yes | — |
| [ ] | Cleaning fee after the trip | Yes | — |
| [ ] | Late return fee | Yes | — |
| [ ] | Tolls passed on to the customer | No | — |
| [ ] | Damage repair charged to the customer | No | — |
| [ ] | Security deposit captured for damage | No | — |
| [ ] | **Cancellation fee kept on a late cancellation** | Yes: we keep the tax on the part of the rental price we keep | Is a cancellation fee a sale? If not, the tax on it should be refunded. |

**Also:** for a charge we can't categorise ("Other"), we charge tax so as not to
under-collect. Is that the right default?

*Code: `TAXABILITY` in `src/lib/tax.ts` (`taxable`, `confirmed`). Cancellation fee tax:
`refundForCancellation` in `src/lib/cancellation-policy.ts`.*

## 5. Rentals longer than 28 days

**Current position.** The rental tax applies to agreements of **28 days or less**. A trip
**booked** for more than 28 days is charged sales tax but no rental tax. A trip booked for
28 days or less that is **extended** past 28 days keeps the rental tax. The Department says
the tax applies to daily or weekly rentals "even if the customer keeps the vehicle for more
than 28 days".

**Questions:**
- [ ] Is a rental **booked** for more than 28 days exempt from the 9.2% rental tax? Is it
  taxed as a lease, and does anything else apply?
- [ ] Is it right that an **extension** past 28 days doesn't change the trip's tax?
- [ ] We price by the day, with no monthly contract. Does the "daily or weekly" wording mean
  even a 30-day booking is a short-term rental?

*Code: `SHORT_TERM_MAX_DAYS` and `isShortTermRental` in `src/lib/tax.ts`.*

## 6. Turo history and the period before registration

**Current position.** Not reviewed. Every rental before rentbluefin.com went through Turo,
which collected tax at its own checkout.

**Questions:**
- [ ] From Bluefin's Turo earnings statements: what tax did Turo collect and remit on
  Bluefin's trips? Is anything owed for any period or type of charge Turo didn't cover?
- [ ] Turo did not charge the 9.2% rental tax. Does that create any liability for Bluefin as
  the vehicle owner?
- [ ] While cars are listed on both Turo and rentbluefin.com, is anything needed to keep the
  two channels separate in Bluefin's records and returns?

*Code: nothing to change.*

## 7. Filing, reporting and records

**Current position.** The admin page **Business → Tax information** downloads a CSV for any
year. It has one row per month, jurisdiction and tax: taxable amount, tax collected, tax
refunded, net. tax.md section 9 describes it. These conventions are our assumption:

- a checkout counts in the **month the booking was made**, and a later charge in the
  **month it was paid**;
- a refund reduces the **month of the original sale**, not the month of the refund.

**Questions:**
- [ ] Are those two conventions right for Bluefin's returns? Should a refund be reported in
  the month it is issued instead?
- [ ] The return asks for **gross sales** and **exempt sales**. The report covers taxed
  sales only. What should be included as gross sales: damage, tolls, captured deposits? And
  should "taxable amount" be reduced by refunds?
- [ ] **Chargebacks.** If a customer disputes a charge and the bank reverses it, the tax was
  already remitted. Can it be recovered, and how?
- [ ] **Rounding.** We round each rate separately, per transaction. For example, Saint
  Paul's 9.875% is computed as four separately-rounded parts. Is that acceptable? The
  combined figure can differ from a single rounding by a cent.
- [ ] How long must the booking, payment and refund records be kept? They are kept
  indefinitely today.
- [ ] Please review a sample CSV (from test bookings) and say what you'd like changed in
  its layout before the first real return.

*Code: `buildTaxReport` in `src/lib/tax-report.ts`; `getTaxSales` in
`src/lib/payments.ts`.*

## 8. Related questions: fleet and equipment purchases

These are not about collecting tax from customers. They come up because the business buys
things in order to rent them.

- [ ] **Vehicles.** Was Minnesota motor vehicle sales tax paid correctly when each car was
  bought? Does buying a vehicle to rent it out change that, or the registration?
- [ ] **Equipment rented to customers** (child seats). If renting a child seat is taxable,
  can the seats be bought tax-exempt for re-rental? What certificate is needed?
- [ ] Anything else about Bluefin's setup an accountant would flag that isn't covered here.

*Code: nothing to change.*

---

## What to bring to the meeting

- [tax.md](tax.md) and this document
- A sample CSV from **Business → Tax information** (made from test bookings, since no real
  sales exist yet)
- The LLC's EIN and Secretary of State registration
- Turo earnings statements covering every year the cars were listed
- A list of the fleet: each vehicle's purchase date, price and the tax paid when it was
  bought

## After the meeting (for the developer)

For each answer:

1. Change the constant in `src/lib/tax.ts` (or the file named in the item), and set its
   `confirmed: true`.
2. Tick the box here, and record the answer and who gave it.
3. Update [tax.md](tax.md) and add a dated row to [decisions-log.md](decisions-log.md).
4. If customer-facing wording changes, update `/policies/terms` section 9 in the same change.
5. Run `npm test`. It includes `scripts/verify-tax.ts` and `scripts/verify-policy-docs.ts`.

When items 1–5 are settled, set `TAX_CONFIG_REVIEWED = true` in `src/lib/tax.ts`.

**Recurring checks:**
- Each quarter (Jan 1, Apr 1, Jul 1, Oct 1): re-check local rates.
- Each January: re-check the 5% fee exemption.
