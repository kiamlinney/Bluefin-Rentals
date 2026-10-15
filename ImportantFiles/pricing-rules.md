# Daily prices, pricing rules, and the Vehicles page

What a day of a trip costs, how the owners change it, and what a change does
(and doesn't do) to trips already booked. Written 2026-10-13, when the Vehicles
admin pages and the automatic pricing rules were built.

## 1. One day's price

Every car has a **base daily price** (`cars.price_per_day`), set on its page
under **Vehicles**. On top of that, three fleet-wide multipliers, set under
**Vehicles → Pricing**:

| Rule | Applies to | Starting value |
|---|---|---|
| Busy | dates inside a busy period | ×1.40 |
| Slow | dates inside a slow period | ×0.85 |
| Weekend | the chosen weekdays (Friday, Saturday, Sunday) | ×1.10 |

The starting values are Liam's ("maybe 1.4", "0.85", "1.1 for now") and live in
the database (`pricing_settings`), not in code, so the owners can change them
without a deploy. The page refuses anything outside
<!-- const:PRICING_MULTIPLIER_RANGE -->0.5 to 3<!-- /const -->, which guards against
typos, not prices.

A day's price is worked out like this (`src/lib/pricing.ts#dailyPrice`):

1. **A price typed for that date on the calendar wins outright.** No multiplier
   touches it. ("Manual price wins", decided by Liam.)
2. Otherwise: base × the period's multiplier (busy or slow, if the date is in
   one) × the weekend multiplier (if it's a weekend day). **They multiply**: a
   busy Saturday on a $60 car is 60 × 1.4 × 1.1 = $92.40.
3. **Rounded to whole dollars**: $92. A day no rule touches is exactly the base
   price, as it always was.

The rest of a quote is unchanged: the length discounts, the same-day surcharge,
the refundable premium, pickup fees, extras and tax all work on the sum of the
days, as before.

**Which days a trip pays for** hasn't changed either: one per 24 hours, rounded
up, counted from the pickup date. A Friday 10am to Sunday 10am trip pays for
Friday and Saturday; to Sunday 8pm, Friday, Saturday and Sunday.

## 2. Busy and slow periods

Each period is a named date range, inclusive at both ends ("State Fair, Aug 26
to Sep 6"). Entered as **specific dates, not repeating ones** (decided by Liam):
holidays move from year to year, so each period has a **Copy to next year**
button that keeps the month and day for the owners to check.

**Periods never overlap**, busy and slow alike. The page refuses an overlap, and
the database refuses it too (an exclusion constraint), so two owners saving at
once can't both get one in. A date is therefore in at most one period, and there
is no rule needed for which one wins.

## 3. Where the price is worked out, and why it can't drift

Every quote goes through the same function with the same rules:

- the car page and checkout, in the browser, with the rules from
  `src/lib/pricing-rules.ts#getPricingRules`;
- the server when it charges, `src/lib/db.ts#createCheckoutSession`, which reads
  them fresh (`src/lib/pricing-rules.server.ts#loadPricingRules`);
- an extension's added days, `src/lib/payments.server.ts#previewExtension`;
- the admin calendar's cells, and the calendar's "+$10" and "set price" tools,
  which start from the price the cell shows.

The rules are a **required** input to `calculateTripPrice` and
`calculateExtensionPrice`, so code that forgot them doesn't compile. If the
rules can't be read, checkout fails rather than charging base price on a busy
weekend.

Guests see the effect: the price breakdown labels adjusted days ("Weekend",
"Busy period + Weekend"), checkout says "Includes weekend and busy-period
prices", and the receipt keeps the labels.

## 4. What a change does to trips already booked

**Nothing.** A trip's price is frozen in its booking when it's paid for
(`price_quote`), and that never changes. This covers:

- changing a car's base price;
- changing a multiplier or the weekend days;
- adding, editing or deleting a period.

**Extensions are priced at the prices in force when they're requested**,
including the rules (the same rule as before: "current prices for those dates",
decisions-log row 9). The terms say so, <!-- const:TERMS_SECTION_EXTENSIONS -->section 13<!-- /const -->.

**The per-mile rate is frozen too, as of this change.** It used to be worked out
from the car's *current* base price and per-mile fee every time a receipt or the
reservation page was shown, so editing either one would have quietly re-rated
the mileage on every trip already booked. The terms already promised "the
per-mile rate shown when you booked" (<!-- const:TERMS_SECTION_MILEAGE_FUEL -->section 9<!-- /const -->),
so the code was out of step with them. Checkout now stores the rate with the
quote (`mileageRate`), and every display reads it back
(`src/lib/receipt.ts#mileageRateFor`). Bookings made before this have no stored
rate and are worked out the old way; every one of them is a sandbox test.

**The per-mile rate follows the trip's average daily price**, as it always has
(`src/lib/distance.ts#distanceFeeForTrip`): the car's per-mile fee is the most
it can be, paid by a two-day trip at the base price. So a busy-period trip pays
the full per-mile fee, and a slow-period trip about 15% less. Liam accepted this
on 2026-10-13.

## 5. Listing and unlisting a car

**Vehicles → a car → Unlist** sets `cars.is_available` to false. What that does
(`src/lib/vehicles.ts#setVehicleListed`):

- **Guests can't book it.** Its page stays up, so old and shared links still
  work, but the booking widget is replaced by "This car isn't available to book
  right now", and the page asks search engines not to list it. Checkout refuses
  it on the server too (`src/lib/availability.server.ts#assertCarIsListed`),
  including a checkout started before the car was unlisted. Before this change,
  an unlisted car could still be booked from a direct link.
- **Checkouts in progress on the car are cancelled**, so a payment can't land on
  them later (`src/lib/open-checkouts.server.ts#releaseOpenCheckouts`, the same
  thing blocking a customer does).
- **Trips already booked are not changed.** The dialog lists them; an owner
  cancels or moves any of them from the reservation page. Extensions, pay links
  and vehicle swaps for existing trips keep working.
- **Turo is separate.** The dialog reminds the owners to unlist it there too.

## 6. The change log

Every change made from the Vehicles and Pricing pages is recorded with who made it
and when (`admin_changes`): listing, base price, per-mile fee, lockbox code,
multipliers, weekend days and periods. A lockbox change is recorded without the
code. Recording never blocks the change itself; a failure to record is logged
for Railway instead.

## 7. Lockbox codes

Lockbox codes live in `car_secrets`, which only the server can read. `cars` is
readable by anyone with the public key, so a code may never go there. The code is
the same one guests get through the existing rules (only once their deposit hold
is in place). Editing it on the car's page replaces the hand-written SQL. A code
already emailed doesn't change; the trip page always shows the current one.

VINs are in `car_secrets.vin` too, entered by Liam in Supabase. Each car's page
shows its VIN read-only with a link to NHTSA's recall lookup for that car: federal
law generally bars renting out a car with an open safety recall until it's
repaired, and off Turo nobody runs that check for us. There's no editing on the
site (Liam: a VIN never changes once it's entered).

## 8. Tests

`tests/pricing-rules.test.ts` and `tests/vehicles.test.ts`, part of `npm test`.
Each guard was checked by putting the bug back and watching a test fail:

- the server quoting without the rules;
- an extension priced without them;
- the listing check missing on either checkout path;
- unlisting closing other cars' checkouts;
- the frozen mileage rate being ignored.

Rehearsal steps that need real Stripe are in `go-live-checklist.md`.
