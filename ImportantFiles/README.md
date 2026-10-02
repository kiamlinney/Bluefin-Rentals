# Bluefin payment & policy records

The permanent written record of every rule about money at Bluefin: what a guest is
charged, when, on what consent, and what comes back. These documents are for **you**
to review and to hold the code to. The customer-facing pages (`/policies/terms`,
`/policies/cancellation`, the checkout consent line) are written from them.

> **Status (2026-10-02):** complete for the Stripe overhaul (saved cards, charge
> ledger, deposits, extensions, extras, cancellation, tax). Written against the final
> code. The local sandbox rehearsal (go-live checklist step 1, Tests 1–12) passed on
> 2026-09-29. **Start with [decisions-log.md](decisions-log.md)** (rows marked Proposed or
> Placeholder are waiting on you), then [go-live-checklist.md](go-live-checklist.md)
> from step 1c.

## The documents

| Document | What it answers |
|---|---|
| [payments-overview.md](payments-overview.md) | How money moves end to end: checkout, card on file, the charge ledger, the Stripe webhook, sandbox vs live |
| [deposit.md](deposit.md) | The security deposit hold: amount, when it's placed, renewal on long trips, release, capture for damage, what happens on a decline |
| [extensions.md](extensions.md) | Extending a trip: when it's automatic, when it needs approval, how it's priced |
| [charges-and-invoicing.md](charges-and-invoicing.md) | Charging a guest after checkout: extras, damage, mileage and other charges, the pay link, receipts |
| [cancellation-and-refunds.md](cancellation-and-refunds.md) | What a cancellation refunds, for the trip and for everything charged after it |
| [tax.md](tax.md) | How tax is calculated, every rate with its source, and which parts are placeholders |
| [tax-todo.md](tax-todo.md) | **Your checklist** of tax questions to answer (with or without an accountant) and where each answer goes in the code |
| [decisions-log.md](decisions-log.md) | Every policy decision, dated, and whether you decided it or it's a proposal awaiting your review |
| [go-live-checklist.md](go-live-checklist.md) | Everything that must happen before real payments are taken |

## How these stay true

1. **A payment change isn't finished until three things ship together:** the code, the
   rule written here, and the customer-facing page that states it. (Same rule as
   CLAUDE.md's "Money is a legal record".)
2. **Code is referenced by file and symbol name**, e.g. `src/lib/deposit.ts` → `DEPOSIT_AMOUNT`,
   not by line number, because line numbers move every edit.
3. **Numbers are tagged against their constants.** A figure written as
   `<!-- const:DEPOSIT_AMOUNT -->$1,500<!-- /const -->` is checked by
   `scripts/verify-policy-docs.ts`, which fails if the document and the code ever disagree,
   or if a referenced symbol no longer exists:

   ```bash
   node --experimental-strip-types scripts/verify-policy-docs.ts
   ```
4. **Rules that come from outside Bluefin** (Stripe's limits, Minnesota tax law) link
   their source.

The other checks, all plain scripts that exit non-zero on failure:

```bash
node --experimental-strip-types scripts/verify-cancellation-policy.ts   # refunds
node --experimental-strip-types scripts/verify-extension-pricing.ts     # extensions
node --experimental-strip-types scripts/verify-tax.ts                   # tax arithmetic
```

## Where these live

`ImportantFiles/`, at the top of the repository, **committed to git** so every version of
every rule is backed up and has a history. (They moved here from `ClaudeFiles/policies/`
on 2026-09-29; `ClaudeFiles/` stays git-ignored for personal files.) Keep any future
important business or policy document here too.
