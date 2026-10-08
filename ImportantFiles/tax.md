# Minnesota sales and rental tax: how Bluefin calculates and collects it

*Prepared for review by Bluefin Rentals LLC's accountant. Checked against the code on
2026-10-08.* The open questions are in [tax-todo.md](tax-todo.md). This document describes
what the booking system does today and where each rule came from. Sections 1–9 are for the
accountant. Section 10 maps each rule to the code, for whoever changes it.

> **Status: tax is collected using published rates and our own reading of the guidance.
> It has not yet been reviewed by an accountant.**
> Tax collection is on (`TAX_ENABLED` = <!-- const:TAX_ENABLED -->true<!-- /const -->).
> On 2026-09-27 we decided to collect at the best available figures rather than collect
> nothing. Review flag: `TAX_CONFIG_REVIEWED` = <!-- const:TAX_CONFIG_REVIEWED -->false<!-- /const -->.
> Online bookings are paused until launch, so **no tax has yet been collected from a real
> customer.** Each assumption below is marked **Confirmed** (taken from a published rate or
> the Department's own wording) or **Unconfirmed** (our reading; needs review).

---

## 1. The business, in brief

| | |
|---|---|
| Entity | Bluefin Rentals LLC (Minnesota) |
| Activity | Short-term rental of passenger vehicles the company owns, booked directly by customers at rentbluefin.com |
| Base of operations | 2033 Sargent Avenue, Saint Paul, MN 55105 (Ramsey County), the "home base" |
| Fleet | 9 vehicles listed (as of 2026-10-08) |
| Rental length | Booked by the day, any length; discounts from 3 days |
| Payments | Card only, through Stripe. Tax is calculated by Bluefin's own software (section 3) and charged in the same payment. |
| Previous channel | Turo, a peer-to-peer car-sharing marketplace. The business is moving its bookings off Turo. During the transition, cars are still listed on both. |

**Bluefin, not Turo, is responsible for the tax on direct bookings.** On a Turo trip, Turo
calculated and collected the tax at checkout. On a rentbluefin.com booking, nobody else is
in the middle, so Bluefin must hold a sales tax permit, collect the tax and file the
returns. No permit is held yet (tax-todo.md, item 1).

**Turo's checkout is not a guide to what Bluefin owes.** Turo shows guests one sales tax
line (about 9.875% in Saint Paul) and no rental tax. Turo is peer-to-peer car sharing and
has lobbied to exempt that from the 9.2% rental tax
([SF 1516, 2023](https://www.billtrack50.com/billdetail/1564874), not passed;
[SF 2650, 2025](https://www.revisor.mn.gov/bills/94/2025/0/SF/2650/versions/0/), introduced).
As of 2026-09-29 the statute contains no such exemption. Even if one passed, it would cover
car-sharing platforms, not a company renting out its own fleet.

## 2. What Minnesota charges on a short-term vehicle rental

**Sources:**
- [Minn. Stat. § 297A.64](https://www.revisor.mn.gov/statutes/cite/297A.64) (rental tax and fee)
- [Revenue Notice #06-08, *Motor Vehicle Leases: Taxes and Fee*, modified 2025-09-08](https://www.revenue.state.mn.us/sites/default/files/2025-09/modification-rn-06-08.pdf)
- [Department of Revenue, *Short-Term Rentals*](https://www.revenue.state.mn.us/guide/short-term-rentals-0)

Per the Revenue Notice, a rental of 28 days or less is "subject to state and local sales
taxes, the 9.2 percent motor vehicle rental tax, and the 5 percent motor vehicle rental
fee". All of them are computed "on the sales price, which would be the same base amount for
each tax or fee".

| Tax | Rate | Applies to | Bluefin's treatment | Status |
|---|---|---|---|---|
| State general sales tax | <!-- const:MN_STATE_SALES_TAX -->6.875%<!-- /const --> | All rentals | Charged | Confirmed (published rate) |
| Local sales taxes | Depends on where the car is picked up (section 4) | All rentals | Charged | Saint Paul confirmed; others unconfirmed |
| Motor Vehicle Rental Tax | <!-- const:MN_RENTAL_MOTOR_VEHICLE_TAX -->9.2%<!-- /const --> | Rentals of <!-- const:SHORT_TERM_MAX_DAYS -->28<!-- /const --> days or less | Charged on the same base as sales tax | Rate confirmed |
| Motor Vehicle Rental Fee | <!-- const:MN_RENTAL_VEHICLE_FEE -->5%<!-- /const --> | Rentals of 28 days or less, unless the lessor is exempt | **Not charged** (`RENTAL_FEE_APPLIES` = <!-- const:RENTAL_FEE_APPLIES -->false<!-- /const -->) | **Unconfirmed**: we believe the exemption applies |

**How the taxes relate:**

- **They don't compound.** Each one is a percentage of the rental price, never of another
  tax. The Revenue Notice keeps customer-paid taxes out of the base "if they are separately
  stated", and every Bluefin checkout and receipt states them separately.
- **The customer pays them; Bluefin collects and remits.** The statute makes the lessor
  collect, report and pay the rental tax (§ 297A.64 subd. 3), the same way as sales tax. The
  Department's guide says to report the 9.2% tax on the **"Car Rentals" line** of the sales
  tax return.
- **The 5% fee exemption.** A lessor is exempt if, in the **prior calendar year**, it had no
  more than 20 vehicles available for rent, **or** $50,000 or less in gross receipts subject
  to the fee. The test is re-run every year. If the fee does apply, it is reported once a
  year (on the December, Q4 or annual return), less the registration taxes paid on the
  rental vehicles.

**Effective total at the home base: 19.075%** of the taxable price. That is 9.875% Saint
Paul sales tax plus the 9.2% rental tax. If the 5% fee applied, it would be 24.075%.

**Short-term classification.** A trip booked for 28 days or less gets the rental tax. A
trip **booked** for longer gets sales tax only (**Unconfirmed**, tax-todo.md item 5).
Extending a trip past 28 days never removes the rental tax. The Department says the tax
applies to daily or weekly rentals "even if the customer keeps the vehicle for more than 28
days", so the classification is fixed by the length originally booked.

## 3. Why Bluefin calculates tax itself instead of using Stripe Tax

Stripe Tax was considered and rejected for three reasons:

1. It calculates Minnesota sales tax but **not the 9.2% Motor Vehicle Rental Tax**
   ([Stripe: Minnesota](https://docs.stripe.com/tax/supported-countries/united-states/collect-tax.md?tax-jurisdiction-united-states=minnesota)).
2. It has **no product tax code for vehicle rental** ([Stripe tax codes](https://docs.stripe.com/tax/tax-codes.md)).
3. It taxes by **where the customer lives**. A rental is taxed **where the customer receives
   the car**. A Wisconsin resident picking up in Saint Paul owes Saint Paul's tax.

## 4. Local taxes: sourced to where the car is picked up

**Sourcing rule.** A rental without recurring periodic payments is sourced like a retail
sale ([Minn. Stat. § 297A.668](https://www.revisor.mn.gov/statutes/cite/297A.668) subd. 4(b)).
- Received at the seller's business location: taxed **there** (subd. 2(b)).
- Delivered elsewhere: taxed **where the customer receives it** (subd. 2(c)).

**Rates.** Taken from the Department's
[Local Sales and Use Tax Rate Guide, 10/1/2026–12/31/2026](https://www.revenue.state.mn.us/sites/default/files/2026-08/local-sales-and-use-tax-rate-guide-2026-q4.pdf).
The guide is published every quarter, and the rates are re-checked against each new edition.

**Several local taxes apply at once because different governments levy them.** In Saint
Paul there are three:

- the Metro Area taxes (0.75% transportation + 0.25% housing), levied across the
  seven-county metro;
- Saint Paul's own city tax (1.5%);
- Ramsey County's transit tax (0.5%).

Each is a slice of one combined rate on the same price, and the return reports each slice
separately. The home base address was confirmed to be inside Saint Paul city limits, in
Ramsey County, on 2026-09-29 with the [Census geocoder](https://geocoding.geo.census.gov/geocoder/).

Customers choose one of these pickup options:

| Pickup option | Fee | Taxed as | Local taxes | Combined sales tax | Status |
|---|---|---|---|---|---|
| Home base, 2033 Sargent Ave | none | Saint Paul | Metro 1.00% + city 1.50% + Ramsey transit 0.50% | <!-- const:TAX_SAINT_PAUL_COMBINED -->9.875%<!-- /const --> | Confirmed from the rate guide |
| The Grand Hotel, 615 2nd Ave S, Minneapolis | <!-- const:LISTED_PICKUP_FEE -->$100<!-- /const --> | Minneapolis | Hennepin County 0.15% + metro 1.00% + city 0.50% + Hennepin transit 0.50% | <!-- const:TAX_MINNEAPOLIS_COMBINED -->9.025%<!-- /const --> | **Unconfirmed**: the guide's row did not read cleanly |
| MSP Airport | $100 | Fort Snelling (Unorganized Territory), Hennepin County | County 0.15% + metro 1.00% + Hennepin transit 0.50%; no city tax | <!-- const:TAX_MSP_COMBINED -->8.525%<!-- /const --> | **Unconfirmed**: the airport has its own row in the guide |
| MSP light rail station | $100 | Same as MSP Airport | Same as MSP Airport | 8.525% | **Unconfirmed** |
| Delivery to the customer's address, within <!-- const:DELIVERY_RADIUS_MILES -->10<!-- /const --> miles of the home base | <!-- const:DELIVERY_FEE -->$120<!-- /const --> | **Saint Paul (home base)** | As home base | 9.875% | **Unconfirmed, and probably wrong**: § 297A.668 subd. 2(c) points to the delivery address's rates |

Each combined rate excludes the 9.2% rental tax, which is the same everywhere. With it, a
$100.00 rental is taxed $19.08 at the home base, $18.23 in Minneapolis and $17.73 at MSP.

## 5. What is taxed

The Revenue Notice states the rule but does not list specific charges:

- **Included in the base:** "any charges by the lessor for goods or services that are
  necessary to complete the transaction", and "any mandatory charges".
- **Excluded from the base:** "damage waiver fees and optional personal accident liability
  insurance". Bluefin sells neither.
- **Not addressed:** fuel, cleaning, optional add-ons such as a child seat, and charges made
  after the trip.

Where the guidance is silent, we chose the treatment we understand to be most common in the
rental industry. **Every row below except the rental itself is unconfirmed.** Every taxed
charge is taxed at the trip's full rate, including the rental tax.

**At checkout** (the guest chooses these when booking):

| Charge | Price | Taxed? | Our reasoning | Status |
|---|---|---|---|---|
| Daily rental rate, after discounts | per car and date | Yes | The rental itself | Confirmed |
| Duration discounts (5–20%, plus a long-trip discount) | reduce the price | Tax is on the discounted price | A seller's discount reduces the sales price | Confirmed |
| Same-day booking surcharge | <!-- const:SAME_DAY_SURCHARGE -->5%<!-- /const --> of the rental | Yes | Part of the rental price | Unconfirmed |
| Refundable-rate premium (an optional higher price that buys free cancellation) | <!-- const:REFUNDABLE_SURCHARGE -->10%<!-- /const --> of the rental | Yes | Part of the rental price | Unconfirmed |
| Pickup fee (hotel, airport, light rail) or delivery fee | $100 / $120 | Yes | Minnesota generally includes delivery charges in the sales price; a pickup-location fee is treated the same way | Unconfirmed |
| Prepaid refuel (optional) | <!-- const:EXTRA_PREPAID_REFUEL -->$70/trip<!-- /const --> | Yes | Treated as part of the rental. **Motor fuel is generally exempt from sales tax, so this may be wrong.** | Unconfirmed |
| Unlimited mileage (optional) | <!-- const:EXTRA_UNLIMITED_MILEAGE -->$80/day<!-- /const --> | Yes | A term of the rental, so part of its price | Unconfirmed |
| Child seat (optional) | <!-- const:EXTRA_CHILD_SEAT -->$25/trip<!-- /const --> | Yes | Equipment rented with the vehicle | Unconfirmed |

**After checkout** (the owners add these to the trip; each is a separate card charge with
its own receipt):

| Charge | Taxed? | Our reasoning | Status |
|---|---|---|---|
| Trip extension (more days) | Yes, at the trip's rates and classification | More rental time | Unconfirmed |
| Child seat or prepaid refuel added after booking | Same as at checkout | — | Unconfirmed |
| Mileage overage (per mile beyond the allowance) | Yes | Per-mile charges are part of the rental price | Unconfirmed |
| Fuel (car returned with less fuel) | Yes | Treated as a rental charge. **May be exempt as fuel.** | Unconfirmed |
| Cleaning | Yes | Connected with the rental | Unconfirmed |
| Late return | Yes | More rental time | Unconfirmed |
| Tolls | **No** | Passes through a government charge; not a sale | Unconfirmed |
| Damage repair | **No** | Reimbursement for loss, not a sale | Unconfirmed |
| Security deposit, when kept for damage | **No** | Same as damage | Unconfirmed |
| "Other" (anything the owners can't categorise) | Yes | Taxed so as not to under-collect; the owner sees the tax before charging | Unconfirmed |

**The security deposit.** A hold of <!-- const:DEPOSIT_AMOUNT -->$1,500<!-- /const --> is placed on the guest's card before pickup and
normally released untouched. It becomes a sale only if part of it is captured, and that is
only done for damage. See [deposit.md](deposit.md).

## 6. How the tax is calculated

- **One base per transaction.** The taxable lines of a checkout (or of one later charge) are
  added together. Each tax rate is applied **once** to that sum and rounded to the cent. Tax
  is not computed line by line.
- **Stored per rate, shown grouped.** Each rate is stored as its own line: state, each local
  tax, rental tax. That matches how the return reports them. Customers see two lines,
  "Sales tax (9.875%)" (state and local combined) and "Minnesota rental vehicle tax (9.2%)".
  This is how a rental counter presents it. Grouping is for display only: it never changes
  an amount.
- **Frozen at the time of sale.** The rates and amounts are saved with the booking or charge.
  A later rate change never alters a past receipt.
- **Charges after checkout use the trip's own jurisdiction and classification.** An
  extension of a Minneapolis pickup is taxed at Minneapolis rates.

**Worked example.** A 3-day rental from the home base at $95/day ($285.00) with a child seat
($25.00):

| Line | Base | Rate | Tax |
|---|---|---|---|
| Minnesota sales tax | $310.00 | 6.875% | $21.31 |
| Metro area sales tax | $310.00 | 1.000% | $3.10 |
| Saint Paul sales tax | $310.00 | 1.500% | $4.65 |
| Ramsey County transit tax | $310.00 | 0.500% | $1.55 |
| Minnesota rental vehicle tax | $310.00 | 9.200% | $28.52 |
| **Total tax** | | **19.075%** | **$59.13** |

The customer sees "Sales tax (9.875%) $30.61" and "Minnesota rental vehicle tax (9.2%)
$28.52", and pays **$369.13**.

## 7. Refunds and cancellations

- **A refund returns tax in proportion to the pre-tax amount refunded.** If 60% of the
  pre-tax price is refunded, 60% of each tax line is refunded with it.
- **A kept cancellation fee keeps its tax.** When a guest cancels late, Bluefin keeps part
  of the rental price as a cancellation fee. We currently keep the tax on that part too, as
  if it were still rental income. **Unconfirmed**: a cancellation fee may not be a taxable
  sale at all, in which case its tax should be refunded (tax-todo.md, item 4). The
  cancellation rules are in [cancellation-and-refunds.md](cancellation-and-refunds.md).
- Pickup/delivery fees and optional extras are refunded in full on any cancellation that
  carries a refund, with their tax.
- A trip refunded in full nets to zero tax in the report.

## 8. What customers are told

- **Car page:** prices are shown "before tax".
- **Checkout:** the two tax lines appear above the trip total. The total is the amount
  charged.
- **Receipts and later-charge receipts:** the tax lines, as charged.
- **Terms of service, section 9 (Taxes):** prices are before tax; sales tax is the state's
  plus the local taxes where the car is picked up; the 9.2% rental tax applies to rentals of
  28 days or less; later charges are taxed the same way; a refund returns the tax on the
  amount refunded.

## 9. Records and the tax report

The admin page **Business → Tax information** (`/admin/business/tax-information`) totals the
tax collected for a chosen year and downloads it as a CSV. It has one row per month,
jurisdiction and tax, with these columns:
**Month · Jurisdiction · Tax · Taxable amount · Collected · Refunded · Net**.

**Reporting conventions** (**Unconfirmed**, tax-todo.md item 7):
- **When a sale counts:** a checkout counts in the month the booking was made, in Central
  time. A booking must be paid within an hour of being made, so the two dates are almost
  always in the same month. A later charge counts in the month its payment settled.
- **When a refund counts:** it reduces the tax of the **month of the original sale**, not
  the month the refund was issued.

**What the report does not show yet.** These are gaps to close once the accountant says what
the return needs (tax-todo.md, item 7):
- **Untaxed charges.** Damage, tolls and kept deposits are left out entirely. The report has
  no **gross sales** or **exempt sales** totals.
- **Refunds in the taxable amount.** "Taxable amount" is gross. Refunds reduce the tax
  columns but not the taxable amount.
- **Turo trips.** They are not in the report. Turo collected that tax.

**Underlying records.** For every booking and charge, the database keeps the date, customer,
pickup location and jurisdiction, each priced line, each tax line and the refunds. Stripe
holds the matching payment and refund records.

## 10. For developers: where each rule lives

All tax rules are in one module. Every quote, charge, receipt and refund calls it, so they
cannot disagree.

| Rule | Code |
|---|---|
| The calculation | `src/lib/tax.ts#calculateTax` |
| Master switch and review flag | `src/lib/tax.ts#TAX_ENABLED`, `src/lib/tax.ts#TAX_CONFIG_REVIEWED` |
| State rates | `src/lib/tax.ts#MN_STATE_SALES_TAX`, `src/lib/tax.ts#MN_RENTAL_MOTOR_VEHICLE_TAX`, `src/lib/tax.ts#MN_RENTAL_VEHICLE_FEE` |
| Whether the 5% fee is charged | `src/lib/tax.ts#RENTAL_FEE_APPLIES` |
| Short-term cutoff | `src/lib/tax.ts#SHORT_TERM_MAX_DAYS`, `src/lib/tax.ts#isShortTermRental` |
| Local rates | `src/lib/tax.ts#TAX_JURISDICTIONS` |
| Pickup → jurisdiction (and the delivery placeholder) | `src/lib/tax.ts#taxJurisdictionForPickup` |
| What's taxable | `src/lib/tax.ts#TAXABILITY` |
| Later charges use the trip's context | `src/lib/tax.ts#taxContextFromQuote` |
| Display grouping | `src/lib/tax.ts#displayTaxLines` |
| Tax at checkout | `src/lib/pricing.ts#calculateTripPrice` |
| Owner charge categories → tax keys | `src/lib/charges.ts#CHARGE_CATEGORIES` |
| Tax refunded on cancellation | `src/lib/cancellation-policy.ts#refundForCancellation`, `src/lib/cancellation-policy.ts#laterChargeRefund` |
| The tax report | `src/lib/tax-report.ts#buildTaxReport`, `src/lib/payments.ts#getTaxSales` |

Each rate and taxability entry carries `confirmed: true/false`, and each stored tax line
carries `placeholder: true` while anything it depends on is unconfirmed.

**Tests.**
- `scripts/verify-tax.ts`: 25 arithmetic checks. They can't tell whether a rule is legally
  right; only tax-todo.md can.
- `scripts/verify-policy-docs.ts`: fails if a number tagged in this document drifts from
  the code.
- Both run in `npm test`.

**Changing a rule:**
1. Change the constant.
2. Set its `confirmed` flag.
3. Update this document, [tax-todo.md](tax-todo.md) and [decisions-log.md](decisions-log.md)
   in the same change.
4. Run `npm test`.
