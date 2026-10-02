# Tax

*Last checked against the code: 2026-09-29.* Everything lives in `src/lib/tax.ts#calculateTax`
and the constants above it. Tested by `scripts/verify-tax.ts` (25 checks: arithmetic only;
it can't tell you if a rule is legally right). **Your to-do list is [tax-todo.md](tax-todo.md).**

> **Status: collecting with best-available figures, NOT reviewed by an accountant.**
> `TAX_CONFIG_REVIEWED` = <!-- const:TAX_CONFIG_REVIEWED -->false<!-- /const -->.
> Tax is switched on (`TAX_ENABLED` = <!-- const:TAX_ENABLED -->true<!-- /const -->)
> because you decided (2026-09-27) to collect with the best figures rather than none.
> Bookings are paused until launch anyway. Do not take real payments until tax-todo.md
> is worked through.

## Who collects and files: now Bluefin

**Taking bookings on rentbluefin.com, Bluefin collects the tax and files the returns
itself.** That needs a Minnesota sales tax permit before the first live booking
(tax-todo.md, item 1).

**Turo's checkout is not a guide to what Bluefin owes.** A Turo trip is *peer-to-peer car
sharing*: a platform connecting an owner with a driver. Turo has been pushing to exempt
that from the 9.2% rental tax: [SF 1516 (2023)](https://www.billtrack50.com/billdetail/1564874)
died, and [SF 2650 (2025)](https://www.revisor.mn.gov/bills/94/2025/0/SF/2650/versions/0/)
was introduced to exempt it from 2026-01-01. Checked 2026-09-29, the statute has no such
exemption (its history ends at 2023). Either way it wouldn't cover Bluefin: renting your
own fleet directly is a plain short-term rental, which is exactly what the statute taxes.
Turo shows guests one sales tax line (about 9.875% in Saint Paul, the same rate as ours).
What Turo collected on your past trips is tax-todo.md, item 6.

## Why not Stripe Tax

- It calculates Minnesota sales tax, but **not the 9.2% Motor Vehicle Rental Tax**.
  [Stripe: collecting tax in Minnesota](https://docs.stripe.com/tax/supported-countries/united-states/collect-tax.md?tax-jurisdiction-united-states=minnesota)
- It has **no product tax code for vehicle rental**. [Stripe tax codes](https://docs.stripe.com/tax/tax-codes.md)
- It taxes by **where the customer lives**; a rental is taxed **where the car is rented**.
  A Wisconsin guest picking up in Saint Paul owes Minnesota tax.

## What Minnesota charges on a short-term rental

Sources: [MN Dept of Revenue: Short-Term Rentals](https://www.revenue.state.mn.us/guide/short-term-rentals-0);
statute [Minn. Stat. 297A.64](https://www.revisor.mn.gov/statutes/cite/297A.64);
[Revenue Notice #06-08, *Motor Vehicle Leases: Taxes and Fee*, modified 2025-09-08](https://www.revenue.state.mn.us/sites/default/files/2025-09/modification-rn-06-08.pdf).
The notice is the Department's current position. Rentals of 28 days or less "are subject to
state and local sales taxes, the 9.2 percent motor vehicle rental tax, and the 5 percent
motor vehicle rental fee", all computed "on the sales price, which would be the same base
amount for each tax or fee".

**The guest pays all of it, and none of it compounds.** Each tax is a percentage of the
rental price, never of another tax. The notice says taxes on the customer stay out of the
base "if they are separately stated", which our receipts do. The statute makes the business
collect, report and pay it (297A.64 subd. 3), like sales tax. It isn't a tax on the
business's income. A rental company that doesn't qualify for the 5% fee exemption charges
about 24% in Saint Paul. Bluefin charges 19.075%.

| Tax | Rate | In the code | Status |
|---|---|---|---|
| State sales tax | <!-- const:MN_STATE_SALES_TAX -->6.875%<!-- /const --> | `src/lib/tax.ts#MN_STATE_SALES_TAX` | Confirmed (published rate) |
| Local sales taxes | by pickup location, below | `src/lib/tax.ts#TAX_JURISDICTIONS` | Partly confirmed |
| Motor Vehicle Rental Tax | <!-- const:MN_RENTAL_MOTOR_VEHICLE_TAX -->9.2%<!-- /const --> on the same base as sales tax, short-term only | `src/lib/tax.ts#MN_RENTAL_MOTOR_VEHICLE_TAX` | Confirmed (published rate) |
| Motor Vehicle Rental Fee | <!-- const:MN_RENTAL_VEHICLE_FEE -->5%<!-- /const -->, **not charged**: `RENTAL_FEE_APPLIES` = <!-- const:RENTAL_FEE_APPLIES -->false<!-- /const --> | `src/lib/tax.ts#RENTAL_FEE_APPLIES` | **Placeholder**: you believe Bluefin is exempt |

The 5% fee's exemption, per the Department: no more than 20 vehicles available for rent,
**or** $50,000 or less in fee-subject receipts, in the **prior calendar year**. Re-check
each January; growth can end it.

**Short-term** means an agreement for <!-- const:SHORT_TERM_MAX_DAYS -->28<!-- /const -->
days or less. A trip **booked** for longer gets sales tax but no rental tax
(**placeholder**). An extension never changes the classification, because the Department
says the tax applies to daily or weekly rentals "even if the customer keeps the vehicle
for more than 28 days".

## Local taxes: by where the car is picked up

From the Department's [Local Sales and Use Tax Rate Guide, 10/1/2026–12/31/2026](https://www.revenue.state.mn.us/sites/default/files/2026-08/local-sales-and-use-tax-rate-guide-2026-q4.pdf)
(published quarterly: **re-check every quarter**). The metro area taxes (0.75%
transportation + 0.25% housing) apply across the seven-county metro.

**Several local taxes apply at once because each is levied by a different government.**
For Saint Paul:
- the Metro Area taxes (1%) are the Legislature's, for the whole seven-county Twin Cities
  area;
- the city tax (1.5%) is Saint Paul's own, voter-approved;
- the transit tax (0.5%) is Ramsey County's.

Each is a slice of one combined rate on the same price, 9.875% in total. The guide lists
them in separate columns ("Other Area", "City", "County Transit") of a single row, "St. Paul",
because the return reports each one separately. The home base, 2033 Sargent Ave, is inside
St. Paul city limits in Ramsey County, checked 2026-09-29 with the
[Census geocoder](https://geocoding.geo.census.gov/geocoder/). Re-check with the Department's
[sales tax rate calculator](https://www.revenue.state.mn.us/sales-tax-rate-calculator) if the
home base ever moves.

| Pickup | Jurisdiction | Combined with state | Status |
|---|---|---|---|
| Home base (2033 Sargent Ave) | Saint Paul: metro 1.00% + city 1.50% + Ramsey transit 0.50% | <!-- const:TAX_SAINT_PAUL_COMBINED -->9.875%<!-- /const --> | Confirmed from the guide |
| The Grand Hotel | Minneapolis: Hennepin 0.15% + metro 1.00% + city 0.50% + transit 0.50% | <!-- const:TAX_MINNEAPOLIS_COMBINED -->9.025%<!-- /const --> | **Placeholder**: guide row was garbled when read |
| MSP airport, MSP light rail | Hennepin (Fort Snelling, no city tax): 0.15% + 1.00% + 0.50% | <!-- const:TAX_MSP_COMBINED -->8.525%<!-- /const --> | **Placeholder**: airport has its own row; may differ |
| Delivery (any address) | Uses the home base's rates | 9.875% | **Placeholder**: likely should be the delivery address's rates |

→ `src/lib/tax.ts#taxJurisdictionForPickup`. With the rental tax, a Saint Paul rental's
tax is about 19.08% on top of the price (checked in `scripts/verify-tax.ts`).

## What's taxed

The rental itself is taxable. **Everything else is a placeholder** until confirmed.
Revenue Notice #06-08 gives the rule but not a list:
- **In the base:** "any charges by the lessor for goods or services that are necessary to
  complete the transaction", and "any mandatory charges".
- **Out of the base:** "damage waiver fees and optional personal accident liability
  insurance".
- **Not mentioned:** fuel, cleaning, optional extras like a child seat, and after-trip
  charges.

Motor fuel is also generally exempt from sales tax, which makes the two fuel rows below the
likeliest to be wrong. → `src/lib/tax.ts#TAXABILITY`

| Charge | Taxed? | Reasoning |
|---|---|---|
| Trip days, discounts, same-day surcharge, refundable premium | Yes (confirmed) | the rental price |
| Delivery fee | Yes | MN generally includes delivery in the sales price |
| Prepaid refuel | Yes | treated as part of the rental; fuel itself is exempt, so maybe not |
| Unlimited mileage | Yes | a term of the rental |
| Child seat | Yes | equipment rented with the car |
| Mileage overage | Yes | per-mile charges are rental price |
| Fuel charge | Yes | as prepaid refuel |
| Tolls | **No** | a pass-through of a government charge |
| Cleaning | Yes | connected with the rental |
| Late return | Yes | more rental time |
| Damage (and a captured deposit) | **No** | reimbursement, not a sale |
| Other | Yes | so as not to under-collect; the form shows the tax before charging |

## How it's calculated and shown

- Each tax rate is applied once to the sum of the taxable lines, rounded to the cent,
  and **stored as one line per rate** (state, each local tax, rental tax). The return and
  the tax report need that detail.
- **Shown as two lines** (three if the 5% fee is ever turned on): "Sales tax (9.875%)",
  the state rate and the local ones summed, and "Minnesota rental vehicle tax (9.2%)".
  That's how a rental counter shows it. Showing five lines read as five taxes piled on
  top of each other. Grouping never changes an amount. Every display goes through it:
  checkout, receipts, later-charge receipts, the pay page, the extension and new-charge
  dialogs, and the charge emails. → `src/lib/tax.ts#displayTaxLines`
- **Car page:** prices before tax ("before tax", "Not including tax, which is shown at
  checkout").
- **Checkout:** the tax above the trip total; the total is what's charged.
  → `src/components/checkout/TripSummaryCard.tsx#TripSummaryCard`
- **Receipts:** the tax, frozen with the quote (quote version 2). Bookings from
  before tax read as untaxed and are unchanged.
- **Later charges** (extensions, extras, owner charges) are taxed by the **same
  jurisdiction and classification as their trip**. → `src/lib/tax.ts#taxContextFromQuote`
- **Refunds** return tax in proportion to the amount refunded (placeholder for a kept
  cancellation fee: see [cancellation-and-refunds.md](cancellation-and-refunds.md)).
- **Customers are told:** `/policies/terms` section 8; checkout; receipts.

## The tax report

`/admin/business/tax-information`: collected tax, refunds and net, by month, place and
tax, with a CSV download for filing. Sales count in the month paid; refunds reduce the
month of the sale (**placeholder** convention, tax-todo.md item 7).
→ `src/lib/tax-report.ts#buildTaxReport`, `src/lib/payments.ts#getTaxSales`
