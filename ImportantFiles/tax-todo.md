# Tax to-do: questions for you (and an accountant)

Written for doing this **without an accountant yet**, in the order that matters. Each
item says what to find out, where, and **exactly what to change in the code** when you
know. After any change: set that entry's `confirmed: true`, update [tax.md](tax.md) and
[decisions-log.md](decisions-log.md), and run:

```bash
node --experimental-strip-types scripts/verify-tax.ts
node --experimental-strip-types scripts/verify-policy-docs.ts
```

When every item is done, set `TAX_CONFIG_REVIEWED = true` in `src/lib/tax.ts`.

This is general information, not tax advice.

---

## 1. Get a Minnesota sales tax permit (before the first real booking)

- [ ] Register Bluefin Rentals LLC for Minnesota sales and use tax through the
  Department of Revenue's online e-Services. You'll need the LLC's EIN and Secretary
  of State details. Start at [Local Sales and Use Taxes](https://www.revenue.state.mn.us/guide/local-sales-and-use-tax-guide)
  and the [Sales and Use Tax](https://www.revenue.state.mn.us/sales-and-use-tax) pages.
- [ ] While registering, make sure the **Motor Vehicle Rental Tax** is added to the
  account. It's reported alongside sales tax.
  [Short-Term Rentals](https://www.revenue.state.mn.us/guide/short-term-rentals-0)
- [ ] Note the **filing frequency** they assign (item 7).
- **Nothing to change in code.** This is what makes collecting the tax legal.

## 2. Confirm the 5% rental fee exemption

- [ ] Count the vehicles Bluefin had **available for rent** last calendar year, and total
  the rental receipts that would be subject to the fee. Exempt if **either** is small:
  ≤ 20 vehicles, **or** ≤ $50,000. [Short-Term Rentals](https://www.revenue.state.mn.us/guide/short-term-rentals-0)
- [ ] Confirm whether Turo trips count toward those numbers.
- **In code:** `src/lib/tax.ts` → `RENTAL_FEE_APPLIES` (now `false`). Set `true` if not
  exempt. **Repeat every January.**

## 3. Confirm the local rates for each pickup location

- [ ] Look up each address in the Department's [Sales Tax Rate Calculator](https://www.revenue.state.mn.us/sales-tax-rate-calculator)
  (or the [rate map](https://taxmaps.state.mn.us/salestax/)):
  - 2033 Sargent Avenue, Saint Paul 55105 (home base): we have **9.875%**
  - 615 2nd Avenue South, Minneapolis 55402 (The Grand Hotel): we have **9.025%**
  - MSP Airport and the MSP light rail station (Fort Snelling): we have **8.525%**
- [ ] Ask whether renting **at the airport** carries any extra airport tax or fee.
- [ ] Ask how a **delivered** car is taxed: at the delivery address's rate? (Now:
  always the home base's rate.) If yes, delivery needs an address-to-rate lookup.
- **In code:** `src/lib/tax.ts` → `TAX_JURISDICTIONS` (each rate, `confirmed`), and
  `taxJurisdictionForPickup` for deliveries.
- **Every quarter:** rates change on Jan 1, Apr 1, Jul 1, Oct 1. Re-check the
  [rate charts](https://www.revenue.state.mn.us/rate-charts-sales-tax).

## 4. Confirm which charges are taxable

For each, ask: is it part of the rental's taxable "sales price" for sales tax **and**
the 9.2% rental tax? Current assumptions are in [tax.md](tax.md#whats-taxed).
- [ ] Delivery fee (we tax it)
- [ ] Refundable-rate premium (we tax it, as rental price)
- [ ] Prepaid refuel and fuel charges (we tax them; fuel is normally exempt)
- [ ] Child seat (we tax it)
- [ ] Unlimited mileage and mileage overage (we tax them)
- [ ] Cleaning and late-return charges (we tax them)
- [ ] Tolls (we don't)
- [ ] Damage charges and deposits kept for damage (we don't)
- [ ] A **kept cancellation fee**: is it taxable? (We keep the tax on it.)
- **In code:** `src/lib/tax.ts` → `TAXABILITY` (`taxable`, `confirmed`). The refund rule
  is in `src/lib/cancellation-policy.ts` → `refundForCancellation`.

## 5. Trips longer than 28 days

- [ ] Is a rental **booked** for more than 28 days exempt from the 9.2% rental tax (and
  taxed as a lease instead)? We currently charge **sales tax only** on those.
- [ ] Confirm that **extending** a trip past 28 days doesn't change its tax (we keep it
  a short-term rental; the Department says the tax applies to daily and weekly rentals
  "even if the customer keeps the vehicle for more than 28 days").
- **In code:** `src/lib/tax.ts` → `SHORT_TERM_MAX_DAYS`, `isShortTermRental`.

## 6. Check what Turo was collecting for you

- [ ] In your Turo earnings/trip statements, find the taxes Turo added to your trips.
  That shows what the state expected, and confirms Turo (not you) filed them.
- [ ] Ask whether you owe anything for any period Turo **didn't** collect.
- **Nothing to change in code**, but it's the best real-world check on items 3–4.

## 7. Filing: how often and how

- [ ] Your filing frequency (monthly, quarterly or annual) comes with the permit.
- [ ] Confirm the reporting conventions the tax report uses: **a sale counts in the
  month it was paid** (checkout: the month the booking was made; later charges: the
  month they settled), and **a refund reduces the month of the original sale**.
- The report: `/admin/business/tax-information` → **CSV**.
- **In code:** `src/lib/tax-report.ts` if the conventions change.

## 8. Hiring an accountant: questions to bring

Bring [tax.md](tax.md), this list, and a CSV from the tax report. Ask:
1. Are we registered correctly, including the rental vehicle tax? (items 1–2)
2. Are our rates right for Saint Paul, Minneapolis, MSP and deliveries? (item 3)
3. Which of our charges are taxable, including kept cancellation fees? (item 4)
4. How are rentals booked for more than 28 days taxed? (item 5)
5. Do we owe anything for the period before we collected tax ourselves? (item 6)
6. Is our month-of-sale / refund convention right for our returns? (item 7)
7. Does anything change as the fleet grows (the 5% fee test)?
