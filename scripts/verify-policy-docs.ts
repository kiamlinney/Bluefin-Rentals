// Keeps ImportantFiles/*.md honest: the written record of every money
// rule must match the code that enforces it.
//
//   node --experimental-strip-types scripts/verify-policy-docs.ts
//
// Two checks, both failing the script:
//
//  1. Every number tagged in a document —
//         <!-- const:DEPOSIT_AMOUNT -->$1,500<!-- /const -->
//     — must equal what the constant says right now. Change a constant and
//     forget the document, and this fails.
//
//  2. Every code reference written as `path#Symbol` —
//         `src/lib/deposit.ts#DEPOSIT_AMOUNT`
//     — must point at a file that exists and still declares that symbol.
//     Rename or delete something a document relies on, and this fails.
//
// It also warns (without failing) while the tax setup is unreviewed.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
    DEPOSIT_AMOUNT,
    DEPOSIT_PLACE_BEFORE_HOURS,
    DEPOSIT_RELEASE_AFTER_HOURS,
    DEPOSIT_RENEW_BEFORE_HOURS,
    DEPOSIT_RETRY_AFTER_HOURS,
    EXTENDED_AUTHORIZATION_ENABLED,
    formatDepositAmount,
} from '../src/lib/deposit.ts'
import { EXTENSION_REQUEST_CUTOFF_MINUTES } from '../src/lib/extension.ts'
import {
    MN_RENTAL_MOTOR_VEHICLE_TAX,
    MN_RENTAL_VEHICLE_FEE,
    MN_STATE_SALES_TAX,
    RENTAL_FEE_APPLIES,
    SHORT_TERM_MAX_DAYS,
    TAX_CONFIG_REVIEWED,
    TAX_ENABLED,
    TAX_JURISDICTIONS,
} from '../src/lib/tax.ts'
import { FREE_CANCELLATION_HOURS, REFUNDABLE_SURCHARGE } from '../src/lib/booking-rate.ts'
import { LATE_BOOKING_GRACE_HOURS, LATE_BOOKING_WINDOW_HOURS, SHORT_TRIP_DAYS } from '../src/lib/cancellation-policy.ts'
import { DELIVERY_FEE, DELIVERY_RADIUS_MILES, LISTED_PICKUP_FEE } from '../src/lib/pickup.ts'
import { MILES_INCLUDED_PER_DAY } from '../src/lib/distance.ts'
import { EXTRAS } from '../src/lib/extras.ts'
import { DISCOUNT_TIERS, LONG_DURATION_DISCOUNT, SAME_DAY_SURCHARGE } from '../src/lib/pricing.ts'
import { PENDING_HOLD_MS } from '../src/lib/availability.ts'

const ROOT = new URL('..', import.meta.url).pathname
const DOCS = join(ROOT, 'ImportantFiles')

const pct = (rate: number) => `${(rate * 100).toFixed(3).replace(/\.?0+$/, '')}%`
const dollars = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const combined = (id: keyof typeof TAX_JURISDICTIONS) =>
    pct(MN_STATE_SALES_TAX.rate + TAX_JURISDICTIONS[id].local.reduce((s, r) => s + r.rate, 0))
const extra = (id: string) => {
    const e = EXTRAS.find(x => x.id === id)
    return e ? `${dollars(e.price)}${e.billing === 'per-day' ? '/day' : '/trip'}` : 'MISSING'
}

// PENDING_HOLD_MS moved to the pure availability.ts on 2026-10-07 (the terms
// page states it), so it's imported like every other constant.
function readPendingHoldHours(): string {
    const hours = PENDING_HOLD_MS / 3_600_000
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/** What each tag must read, exactly as the documents write it. */
const EXPECTED: Record<string, string> = {
    DEPOSIT_AMOUNT: formatDepositAmount(DEPOSIT_AMOUNT),
    DEPOSIT_PLACE_BEFORE_HOURS: String(DEPOSIT_PLACE_BEFORE_HOURS),
    DEPOSIT_RELEASE_AFTER_HOURS: String(DEPOSIT_RELEASE_AFTER_HOURS),
    DEPOSIT_RENEW_BEFORE_HOURS: String(DEPOSIT_RENEW_BEFORE_HOURS),
    DEPOSIT_RETRY_AFTER_HOURS: String(DEPOSIT_RETRY_AFTER_HOURS),
    EXTENDED_AUTHORIZATION_ENABLED: String(EXTENDED_AUTHORIZATION_ENABLED),
    EXTENSION_REQUEST_CUTOFF_MINUTES: String(EXTENSION_REQUEST_CUTOFF_MINUTES),
    PENDING_HOLD: readPendingHoldHours(),
    SHORT_TERM_MAX_DAYS: String(SHORT_TERM_MAX_DAYS),
    MN_STATE_SALES_TAX: pct(MN_STATE_SALES_TAX.rate),
    MN_RENTAL_MOTOR_VEHICLE_TAX: pct(MN_RENTAL_MOTOR_VEHICLE_TAX.rate),
    MN_RENTAL_VEHICLE_FEE: pct(MN_RENTAL_VEHICLE_FEE.rate),
    RENTAL_FEE_APPLIES: String(RENTAL_FEE_APPLIES),
    TAX_ENABLED: String(TAX_ENABLED),
    TAX_CONFIG_REVIEWED: String(TAX_CONFIG_REVIEWED),
    TAX_SAINT_PAUL_COMBINED: combined('saint-paul'),
    TAX_MINNEAPOLIS_COMBINED: combined('minneapolis'),
    TAX_MSP_COMBINED: combined('hennepin-msp'),
    REFUNDABLE_SURCHARGE: pct(REFUNDABLE_SURCHARGE.percent),
    FREE_CANCELLATION_HOURS: String(FREE_CANCELLATION_HOURS),
    LATE_BOOKING_WINDOW_HOURS: String(LATE_BOOKING_WINDOW_HOURS),
    LATE_BOOKING_GRACE_HOURS: String(LATE_BOOKING_GRACE_HOURS),
    SHORT_TRIP_DAYS: String(SHORT_TRIP_DAYS),
    DELIVERY_FEE: dollars(DELIVERY_FEE),
    DELIVERY_RADIUS_MILES: String(DELIVERY_RADIUS_MILES),
    LISTED_PICKUP_FEE: dollars(LISTED_PICKUP_FEE),
    MILES_INCLUDED_PER_DAY: String(MILES_INCLUDED_PER_DAY),
    SAME_DAY_SURCHARGE: pct(SAME_DAY_SURCHARGE.percent),
    LONG_DURATION_DISCOUNT: `${pct(LONG_DURATION_DISCOUNT.percent)} from ${LONG_DURATION_DISCOUNT.minDays} days`,
    DISCOUNT_TIERS: [...DISCOUNT_TIERS].reverse().map(t => `${pct(t.percent)} from ${t.minDays} days`).join(', '),
    EXTRA_PREPAID_REFUEL: extra('prepaid-refuel'),
    EXTRA_UNLIMITED_MILEAGE: extra('unlimited-mileage'),
    EXTRA_CHILD_SEAT: extra('child-seat'),
}

let failures = 0
let tags = 0
let refs = 0
const fail = (msg: string) => { failures++; console.log(`  FAIL  ${msg}`) }

const files = readdirSync(DOCS).filter(f => f.endsWith('.md')).sort()
for (const file of files) {
    const text = readFileSync(join(DOCS, file), 'utf8')

    for (const m of text.matchAll(/<!--\s*const:([A-Z0-9_]+)\s*-->(.*?)<!--\s*\/const\s*-->/g)) {
        tags++
        const [, name, written] = m
        const expected = EXPECTED[name!]
        if (expected === undefined) fail(`${file}: unknown constant tag "${name}" (add it to EXPECTED in this script)`)
        else if (written!.trim() !== expected) fail(`${file}: ${name} is written as "${written!.trim()}" but the code says "${expected}"`)
    }

    for (const m of text.matchAll(/`((?:src|scripts|supabase)\/[^`#\s]+)#([A-Za-z_$][\w$]*)`/g)) {
        refs++
        const [, path, symbol] = m
        const full = join(ROOT, path!)
        if (!existsSync(full)) { fail(`${file}: ${path} does not exist`); continue }
        const src = readFileSync(full, 'utf8')
        const declared = new RegExp(
            `(?:const|let|function|async function|type|interface|class|enum)\\s+${symbol}\\b` +
            `|export\\s*\\{[^}]*\\b${symbol}\\b` +
            `|\\b${symbol}\\s*[:=]\\s*createServerFn` +
            `|case\\s+'${symbol}'` +
            `|create (?:table|or replace function|trigger)(?: if not exists)? (?:public\\.)?${symbol}\\b`,
            'i',
        )
        if (!declared.test(src)) fail(`${file}: ${path} no longer declares ${symbol}`)
    }
}

if (!TAX_CONFIG_REVIEWED) {
    console.log('  WARN  TAX_CONFIG_REVIEWED is false: tax rates and taxability include placeholders (tax-todo.md).')
}

console.log(`\n${files.length} documents, ${tags} tagged numbers, ${refs} code references — ${failures === 0 ? 'all match' : `${failures} problem(s)`}\n`)
process.exit(failures === 0 ? 0 : 1)
