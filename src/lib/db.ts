import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe'
import { google } from 'googleapis'
import {
    buildOverrideMap,
    calculateTripPrice,
    daysBetween,
    timeToMinutes,
    todayInBusinessTz,
    wallClockToUtcIso,
    type TripQuote,
} from './pricing'
import {
    DELIVERY_RADIUS_MILES,
    findPickupLocation,
    milesFromHomeBase,
    resolvePickup,
    type ResolvedPickup,
} from './pickup'
import { geocodeAddresses } from './geocode'
import {
    MIN_LEAD_TIME_HOURS,
    TURNAROUND_HOURS,
    type UnavailabilityRow,
} from './availability'
import { businessDateKey, formatBusinessDateTime } from './dates'

// Fetches all cars that are available
export const getCars = createServerFn({ method: 'GET' })
    .handler(async () => {
        const supabase = getSupabaseServerClient()
        const { data, error } = await supabase
            .from('cars')
            .select('*')
            .eq('is_available', true)
            .order('make', { ascending: true })
            .order('model', { ascending: true })
            .order('year', { ascending: true })

        if (error) throw new Error(error.message)
        return data
    })

// Bridge for the Car Details Page
export const getCarById = createServerFn({ method: 'GET' })
    .inputValidator((carId: string) => carId)
    .handler(async ({ data: carId }) => {
        const supabase = getSupabaseServerClient()
        const { data, error } = await supabase
            .from('cars')
            .select('*')
            .eq('id', parseInt(carId, 10))
            .single()

        if (error) throw new Error("Car not found")
        return data
    })

export const getBookedDates = createServerFn({ method: 'GET' })
    .inputValidator((carId: string) => carId)
    .handler(async ({ data: carId }) => {
        const supabase = getSupabaseServerClient();
        const carIdNum = parseInt(carId, 10)

        const { data, error } = await supabase
            .rpc('get_car_unavailability', { car_id_param: carIdNum });

        if (error) {
            console.error("Error fetching booked dates:", error);
            return [];
        }

        // This endpoint is public (no auth check), so car_blocked_dates and
        // turo_bookings — both admin-only tables under RLS — are read with the
        // service-role client. Only start/end are selected, never renter_name.
        const supabaseAdmin = createClient(
            process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } }
        )

        const [{ data: blocked }, { data: turo }] = await Promise.all([
            supabaseAdmin
                .from('car_blocked_dates')
                .select('start_date, end_date')
                .eq('car_id', carIdNum),
            supabaseAdmin
                .from('turo_bookings')
                .select('start_time, end_time')
                .eq('car_id', carIdNum),
        ])

        // Tagged by source rather than flattened into one shape. The booking
        // widget applies a turnaround buffer to real trips but not to admin
        // blocks, and it can't make that distinction after the fact.
        //
        // Blocks also keep their native date-only form. They used to be
        // converted here into `${b.start_date}T00:00:00` — a string with no zone
        // suffix, which `new Date()` reads as *browser-local* midnight and so
        // shifted a block a day earlier for anyone east of Central. There's no
        // instant in a blocked date to begin with; handing over the keys lets
        // src/lib/availability.ts treat it as the calendar range it actually is.
        return [
            ...(data ?? []).map(b => ({
                kind: 'booking' as const,
                start_time: b.start_time,
                end_time: b.end_time,
            })),
            ...(turo ?? []).map(t => ({
                kind: 'turo' as const,
                start_time: t.start_time,
                end_time: t.end_time,
            })),
            ...(blocked ?? []).map(b => ({
                kind: 'block' as const,
                start_date: b.start_date,
                end_date: b.end_date,
            })),
        ] satisfies UnavailabilityRow[];
    });

// Per-day price overrides for one car, used by the booking widget to quote a
// trip. Like getBookedDates this endpoint is public, and car_price_overrides is
// admin-only under RLS, so it's read with the service-role client. Scoped to a
// single car and to today forward — past overrides can't affect a new booking.
export const getCarPriceOverrides = createServerFn({ method: 'GET' })
    .inputValidator((carId: string) => carId)
    .handler(async ({ data: carId }) => {
        const carIdNum = parseInt(carId, 10)
        if (!Number.isFinite(carIdNum)) return []

        const supabaseAdmin = createClient(
            process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } }
        )

        const { data, error } = await supabaseAdmin
            .from('car_price_overrides')
            .select('date, price')
            .eq('car_id', carIdNum)
            .gte('date', todayInBusinessTz())
            .order('date', { ascending: true })

        if (error) {
            console.error('Error fetching price overrides:', error)
            return []
        }

        return (data ?? []) as { date: string; price: number }[]
    });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as Stripe.StripeConfig['apiVersion'],
})

const MS_PER_HOUR = 60 * 60 * 1000

// A trip may not start sooner than MIN_LEAD_TIME_HOURS from now.
//
// The booking widget already greys out the slots this rejects, but it is not the
// enforcement point — server functions can be called directly, a checkout tab can
// sit open past the cutoff, and every one of these values arrives through an
// editable URL. This is the rule; the widget is the courtesy.
function assertStartIsBookable(startTimeIso: string) {
    const start = new Date(startTimeIso).getTime()
    if (Number.isNaN(start)) throw new Error('Invalid start time')

    if (start < Date.now() + MIN_LEAD_TIME_HOURS * MS_PER_HOUR) {
        throw new Error(
            `Trips must start at least ${MIN_LEAD_TIME_HOURS} hours from now. Please choose a later start time.`
        )
    }
}

// Authoritative server-side conflict check for a car/date-range, checked before
// a new booking is created. Uses the service-role client because a regular
// customer's RLS-scoped client can't see other users' bookings, or
// car_blocked_dates/turo_bookings at all (those are admin-only tables).
//
// Trips need TURNAROUND_HOURS of clearance on both sides for cleaning and
// inspection, so the overlap windows are widened by that buffer rather than
// being a bare intersection test. Widening the *query* rather than filtering
// afterwards keeps the work in Postgres and keeps this a single round trip.
//
// `excludeBookingId` is for the resume-payment paths in createCheckoutSession:
// re-validating an existing pending booking would otherwise find that booking
// itself and refuse to let the customer pay for it.
async function assertCarIsAvailable(
    carId: number,
    startTime: string,
    endTime: string,
    options: { excludeBookingId?: string } = {},
) {
    const supabaseAdmin = createClient(
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
    )

    const bufferMs = TURNAROUND_HOURS * MS_PER_HOUR
    const windowStart = new Date(new Date(startTime).getTime() - bufferMs).toISOString()
    const windowEnd = new Date(new Date(endTime).getTime() + bufferMs).toISOString()

    // Other site bookings: confirmed always blocks; pending only blocks while
    // still "live" (mirrors the 1-hour stale-pending cleanup in getUserBookings)
    const holdCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    let bookingQuery = supabaseAdmin
        .from('bookings')
        .select('start_time, end_time')
        .eq('car_id', carId)
        .in('status', ['pending', 'confirmed'])
        .lt('start_time', windowEnd)
        .gt('end_time', windowStart)
        .or(`status.eq.confirmed,created_at.gte.${holdCutoff}`)
    if (options.excludeBookingId) bookingQuery = bookingQuery.neq('id', options.excludeBookingId)

    const { data: conflictingBookings, error: bErr } = await bookingQuery
    if (bErr) throw new Error(bErr.message)
    if (conflictingBookings?.length) {
        throw new Error(conflictMessage(conflictingBookings, startTime, endTime))
    }

    // Blocked dates are date-only and unbuffered: a block means the car is
    // spoken for those whole days, and the day after it ends is bookable from
    // opening. businessDateKey rather than startTime.slice(0, 10) — the slice
    // takes the UTC day, and a 10pm Central start is already the next day there,
    // which pushed this comparison a day off.
    const startDate = businessDateKey(startTime)
    const endDate = businessDateKey(endTime)
    const { data: conflictingBlocks, error: blErr } = await supabaseAdmin
        .from('car_blocked_dates')
        .select('id')
        .eq('car_id', carId)
        .lte('start_date', endDate)
        .gte('end_date', startDate)
    if (blErr) throw new Error(blErr.message)
    if (conflictingBlocks?.length) throw new Error('This car is not available for the selected dates')

    // Turo trips are real trips, so they get the same buffer as site bookings.
    const { data: conflictingTuro, error: tErr } = await supabaseAdmin
        .from('turo_bookings')
        .select('start_time, end_time')
        .eq('car_id', carId)
        .lt('start_time', windowEnd)
        .gt('end_time', windowStart)
    if (tErr) throw new Error(tErr.message)
    if (conflictingTuro?.length) {
        throw new Error(conflictMessage(conflictingTuro, startTime, endTime))
    }
}

// Turns a conflicting row into something the customer can act on. A trip that
// merely lands inside the turnaround buffer is a different problem from one that
// genuinely overlaps — the first is fixed by nudging a dropdown a few hours, and
// saying "no longer available" would send them hunting for another car instead.
function conflictMessage(
    conflicts: { start_time: string; end_time: string }[],
    startTime: string,
    endTime: string,
): string {
    const start = new Date(startTime).getTime()
    const end = new Date(endTime).getTime()

    const bufferOnly = conflicts.find(c => {
        const cStart = new Date(c.start_time).getTime()
        const cEnd = new Date(c.end_time).getTime()
        return cStart >= end || cEnd <= start
    })

    if (!bufferOnly) return 'This car is no longer available for the selected dates'

    const endsBeforeUs = new Date(bufferOnly.end_time).getTime() <= start
    return endsBeforeUs
        ? `This car is being returned at ${formatBusinessDateTime(bufferOnly.end_time)}. ` +
          `Trips need at least ${TURNAROUND_HOURS} hours between them, so please start later.`
        : `Another trip starts at ${formatBusinessDateTime(bufferOnly.start_time)}. ` +
          `Trips need at least ${TURNAROUND_HOURS} hours between them, so please return earlier.`
}

// The pickup selection as it arrives from the browser: loose, optional fields
// pulled straight off URL search params. Nothing here is trusted.
//
// Note what is absent: coordinates. The picker has them — it needs them to show
// a live distance and fee — but they stay in React state and never enter the
// URL, because the server would have to throw them away regardless. See below.
type PickupInput = {
    pickupKind?: 'home' | 'listed' | 'delivery'
    pickupId?: string
    pickupAddress?: string
}

// Turns that untrusted bag of params into a priced, verified pickup.
//
// ── Why the server geocodes rather than accepting coordinates ────────────────
// The obvious shortcut is to let the client send the lat/lng it already resolved
// and measure those against the home base. But coordinates travelling through an
// editable URL are just numbers the caller chose: nothing would stop a request
// pairing "1 Main St, Duluth" with a point two blocks from the lot. The radius
// check would pass, the fee would be $140, and the host would be committed to a
// 150-mile drive. A check that runs on the caller's own numbers is theatre.
//
// So the *address string* — the thing that will be printed on the reservation and
// actually driven to — is what gets geocoded here. That costs one Mapbox call per
// checkout, negligible beside the Stripe round trip on the same request, and it
// is what makes the radius rule binding. Same principle as `totalPrice` further
// down: values from the browser are display hints, and anything deciding money or
// obligations is recomputed server-side.
//
// ── Why the geocoder's output is discarded ──────────────────────────────────
// Only the *verdict* survives this function — in range or not. The coordinates
// and Mapbox's normalized label are read, used, and dropped; what gets stored is
// the address string the customer submitted.
//
// That's a licensing constraint, not a stylistic one. Mapbox distinguishes
// temporary geocoding (the default, and what the 100k/month free tier covers)
// from permanent geocoding, and temporary results may not be cached or persisted
// at all — writing Mapbox's formatted address into bookings.pickup_location would
// require permanent geocoding, which is separately billed and needs a card on
// file. Treating the lookup as a pure validator keeps this inside temporary use.
//
// It's also the better answer for deliveries independently of licensing: a
// geocoder returns the building, and the customer's own text is where the
// apartment number, gate code or "side door" lives — exactly the details that
// matter to someone actually dropping off a car.
async function resolvePickupOnServer(input: PickupInput): Promise<ResolvedPickup> {
    const kind = input.pickupKind ?? 'home'

    if (kind === 'home') return resolvePickup({ kind: 'home' })

    if (kind === 'listed') {
        // Resolved by id against the same table the widget rendered from, so the
        // stored pickup_location string is one this codebase wrote — never one
        // the customer typed. resolvePickup returns an error for an unknown id;
        // it's surfaced rather than defaulted, since quietly moving someone's
        // airport pickup to the lot is worse than making them pick again.
        if (!input.pickupId || !findPickupLocation(input.pickupId)) {
            throw new Error('That pickup location is no longer available. Please choose another.')
        }
        return resolvePickup({ kind: 'listed', id: input.pickupId })
    }

    const address = input.pickupAddress?.trim()
    if (!address) throw new Error('A delivery address is required for this pickup option.')

    // Geocoding the customer's text, not a suggestion id, is what lets them
    // refine it — "2033 Sargent Ave, Saint Paul, MN 55105, Apt 4B" still resolves
    // to the building. It also means an address edited past recognition after the
    // picker verified it gets caught right here rather than at the kerb.
    const [best] = await geocodeAddresses(address)

    // No result means either a geocoder outage or an address Mapbox can't place.
    // Both are refusals rather than fallbacks: the alternative is charging $140
    // to deliver somewhere we were never able to locate.
    if (!best) {
        throw new Error('We could not verify that delivery address. Please check it and try again.')
    }

    const miles = milesFromHomeBase(best)
    if (miles > DELIVERY_RADIUS_MILES) {
        throw new Error(
            `Delivery is only available within ${DELIVERY_RADIUS_MILES} miles — that address is ${miles} miles away.`,
        )
    }

    // `best` has served its entire purpose and goes no further: it decided the
    // question above, and nothing derived from it is returned or stored. The
    // selection is rebuilt from the customer's own address text, with the verified
    // coordinates attached only so resolvePickup can re-apply the radius rule
    // from a single code path — they die with this function's scope.
    const resolved = resolvePickup({
        kind: 'delivery',
        address,
        lat: best.lat,
        lng: best.lng,
    })

    // Belt and braces, but cheap, and it guarantees the fee and the eligibility
    // decision can never come from two different implementations of the rule.
    if (resolved.error) throw new Error(resolved.error)
    return resolved
}

// Recomputes what a trip costs from data only the server can vouch for: the
// car's base rate and its price overrides, both read with the service-role
// client (car_price_overrides is admin-only under RLS). The client sends a
// price too, but it arrives via URL search params and is never trusted — this
// is what actually gets charged.
//
// The wall-clock strings (startDate/startTime) are what pricing needs, because
// overrides are keyed by calendar date and an ISO instant's calendar date
// depends on the reader's timezone. They're cross-checked against the ISO
// interval below so a caller can't quote a cheap two-day range while reserving
// three weeks.
async function quoteTripOnServer(input: {
    carId: number
    startDateLocal: string
    startTimeLocal: string
    endDateLocal: string
    endTimeLocal: string
    startTimeIso: string
    endTimeIso: string
    // Already verified by resolvePickupOnServer. Passed in rather than resolved
    // here so the geocoder round trip happens once, before this function's own
    // parallel Supabase reads, instead of being buried inside the pricing path.
    pickup: ResolvedPickup
}): Promise<TripQuote> {
    const isoDurationMs = new Date(input.endTimeIso).getTime() - new Date(input.startTimeIso).getTime()

    const supabaseAdmin = createClient(
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
    )

    const [{ data: car, error: carErr }, { data: overrideRows, error: ovErr }] = await Promise.all([
        supabaseAdmin
            .from('cars')
            .select('price_per_day')
            .eq('id', input.carId)
            .single(),
        supabaseAdmin
            .from('car_price_overrides')
            .select('date, price')
            .eq('car_id', input.carId)
            .gte('date', input.startDateLocal)
            .lte('date', input.endDateLocal),
    ])

    if (carErr || !car) throw new Error('Car not found')
    if (ovErr) throw new Error(ovErr.message)

    const quote = calculateTripPrice({
        startDate: input.startDateLocal,
        startTime: input.startTimeLocal,
        endDate: input.endDateLocal,
        endTime: input.endTimeLocal,
        basePricePerDay: Number(car.price_per_day),
        overrides: buildOverrideMap(overrideRows ?? []),
        // The fee comes from the server's own resolution of the pickup, not from
        // anything the client sent — same principle as the base rate and the
        // overrides above, both of which are read here rather than accepted.
        pickupFee: input.pickup.fee,
        pickupFeeLabel: input.pickup.feeLabel,
    })

    if (quote.billableDays < 1) throw new Error('Minimum trip duration is 24 hours')

    // The wall-clock range and the ISO range must describe the same trip. Their
    // durations are compared rather than their absolute instants because we
    // don't know the customer's UTC offset — but an offset cancels out of a
    // duration. The 2-hour tolerance absorbs a DST transition inside the trip;
    // anything larger means the two ranges genuinely disagree, which is how a
    // tampered request would look: a cheap two-day quote reserving three weeks.
    const localDurationMs =
        (daysBetween(input.startDateLocal, input.endDateLocal) * 24 * 60 +
            timeToMinutes(input.endTimeLocal) - timeToMinutes(input.startTimeLocal)) * 60 * 1000

    if (Math.abs(isoDurationMs - localDurationMs) > 2 * MS_PER_HOUR) {
        throw new Error('Trip dates are inconsistent. Please reselect your dates.')
    }

    return quote
}

// ── Payment method families ───────────────────────────────────────────────────
//
// PaymentElement shows exactly the methods the PaymentIntent permits; there is
// no client-side filter for it. Leaving payment_method_types unset lets Stripe
// enable everything switched on in the dashboard, which is what turned the
// payment step into a six-row accordion (Card, Bank, Cash App, Affirm, Amazon
// Pay, Klarna) with nothing expanded.
//
// Naming the types splits that in two: 'card' is a single type, so the Element
// draws the card fields directly with no chooser above them, and 'other' is
// everything else, sitting behind "Pay another way". The `other` list must stay
// a subset of what's actually enabled on the Stripe account — an unenabled or
// ineligible type makes the whole PaymentIntent fail to create.
export type PaymentMode = 'card' | 'other'

const PAYMENT_METHOD_TYPES: Record<PaymentMode, string[]> = {
    card: ['card'],
    other: ['us_bank_account', 'cashapp', 'affirm', 'klarna', 'amazon_pay'],
}

// Whether an existing intent already offers exactly this mode's methods.
//
// automatic_payment_methods is checked first and is the important half. An
// intent created without either parameter gets APM enabled by default (Stripe
// changed the default in Aug 2023), and APM keeps deciding what the Element
// shows no matter what payment_method_types says — which is why a card-only
// list still rendered Bank and Klarna rows.
function intentMatchesMode(intent: Stripe.PaymentIntent, mode: PaymentMode): boolean {
    if (intent.automatic_payment_methods?.enabled) return false

    const wanted = PAYMENT_METHOD_TYPES[mode]
    // Stripe attaches 'link' to card intents on its own; it isn't a choice
    // anyone made here, so it shouldn't count as a mismatch and force a rebuild.
    const current = (intent.payment_method_types ?? []).filter(t => t !== 'link')

    return current.length === wanted.length && wanted.every(t => current.includes(t))
}

// Returns an intent for this booking that offers `mode`'s payment methods,
// rebuilding it if the existing one doesn't.
//
// Rebuild rather than update, because automatic_payment_methods is not an
// updatable field — it isn't in the update endpoint's parameter list, so an
// APM-enabled intent can never be narrowed in place. The only way to get a
// card-only Element is a new intent created with payment_method_types set.
//
// The booking row is repointed at the replacement in the same breath:
// stripe_payment_intent_id holds exactly one id, and an orphaned intent that
// nothing references is one that can be paid without confirming any booking.
async function intentForMode(
    booking: { id: string; total_price: number | string; car_id: number; user_id: string; start_time: string; end_time: string; pickup_location: string | null; stripe_payment_intent_id: string },
    mode: PaymentMode,
) {
    const existing = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id)
    if (intentMatchesMode(existing, mode)) return existing

    const replacement = await stripe.paymentIntents.create({
        // The amount is copied from the row, not recomputed: this booking was
        // priced server-side when it was created and switching how it's paid for
        // is not an occasion to re-quote it.
        amount: Math.round(Number(booking.total_price) * 100),
        currency: 'usd',
        payment_method_types: PAYMENT_METHOD_TYPES[mode],
        metadata: {
            carId: String(booking.car_id),
            userId: booking.user_id,
            startTime: booking.start_time,
            endTime: booking.end_time,
            pickupLocation: booking.pickup_location ?? '',
        },
    })

    if (!replacement.client_secret) throw new Error('Failed to create payment intent')

    const supabaseAdmin = getServiceRoleClient()
    const { error } = await supabaseAdmin
        .from('bookings')
        .update({ stripe_payment_intent_id: replacement.id })
        .eq('id', booking.id)

    if (error) throw new Error(error.message)

    // Only after the row points at the replacement. Cancelling first would leave
    // a window where a failed update strands the booking on a dead intent.
    // Best-effort: an intent Stripe considers uncancellable is abandoned
    // instead, which costs nothing since it was never confirmed.
    try {
        await stripe.paymentIntents.cancel(existing.id)
    } catch {
        // ignore — the replacement is already live and recorded
    }

    return replacement
}

export const createCheckoutSession = createServerFn({ method: 'POST' })
    .inputValidator((input: {
        carId: string
        startTime: string
        endTime: string
        // Wall-clock trip range as the customer picked it, used for pricing.
        // Separate from startTime/endTime above, which are UTC ISO instants.
        startDateLocal: string
        startTimeLocal: string
        endDateLocal: string
        endTimeLocal: string
        totalPrice: number
        // Display string only. Kept in the signature because the checkout page
        // still sends it and it's useful in the mismatch log below, but nothing
        // is priced or stored from it — see resolvePickupOnServer.
        pickupLocation: string
        // The structured selection, re-resolved server-side. `pickupKind` is
        // optional so a request from before this change (an in-flight checkout
        // during a deploy) falls back to the free home-base pickup rather than
        // failing outright.
        pickupKind?: 'home' | 'listed' | 'delivery'
        pickupId?: string
        pickupAddress?: string
        bookingId?: string // optional
        // Which family of payment methods the Element should offer. Has to be
        // decided here rather than in the browser: PaymentElement renders
        // whatever the PaymentIntent allows and gives the client no way to
        // filter it, so "card only" is a property of the intent.
        // Optional, defaulting to card, so an in-flight checkout from before
        // this change keeps working.
        paymentMode?: PaymentMode
    }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const carIdNum = Number.parseInt(data.carId, 10)

        // Checked here, before either resume path below, rather than alongside
        // the other sanity checks further down.
        //
        // Both of those paths hand back a Stripe client secret and return, so
        // anything validated after them isn't validated at all for a resumed
        // booking. That's fine for price — the PaymentIntent is already locked to
        // an amount this server computed — but not for time: a pending booking
        // made two hours ago for a trip starting soon would otherwise still be
        // payable, and a car booked by someone else in the meantime would still
        // take the money.
        assertStartIsBookable(data.startTime)

        // If we have bookingId, use directly
        if (data.bookingId) {
            const { data: existing } = await supabase
                .from('bookings')
                .select('*')
                .eq('id', data.bookingId)
                .eq('status', 'pending')
                .maybeSingle()

            // A pending booking with no intent id isn't reusable — there's nothing
            // to hand back. Off-platform bookings entered by hand have no Stripe
            // intent at all, so this is a real case, not a defensive check.
            // Falling through creates a fresh booking + intent instead of calling
            // Stripe with null, which threw.
            if (existing?.stripe_payment_intent_id) {
                // The row's own times, not data.startTime — those arrive through an
                // editable URL and needn't describe the booking being resumed.
                assertStartIsBookable(existing.start_time)
                await assertCarIsAvailable(
                    existing.car_id,
                    existing.start_time,
                    existing.end_time,
                    { excludeBookingId: existing.id },
                )

                // No re-pricing here: this booking's total was computed server-side
                // when it was created, and its PaymentIntent is already locked to
                // that amount.
                const intent = await intentForMode(
                    { ...existing, stripe_payment_intent_id: existing.stripe_payment_intent_id },
                    data.paymentMode ?? 'card',
                )
                return {
                    clientSecret: intent.client_secret,
                    bookingId: existing.id,
                    totalPrice: Number(existing.total_price),
                }
            }
        }

        // Checking for an existing pending booking for this exact car and user, preventing duplicates
        const { data: existingBooking } = await supabase
            .from('bookings')
            .select('*')
            .eq('car_id', carIdNum)
            .eq('user_id', user.id)
            .eq('status', 'pending')
            .eq('start_time', data.startTime)
            .eq('end_time', data.endTime)
            .maybeSingle()

        // If exists, retrieve existing Stripe intent instead of creating new one.
        // Same guard as above — no intent id means nothing to reuse.
        if (existingBooking?.stripe_payment_intent_id) {
            await assertCarIsAvailable(carIdNum, data.startTime, data.endTime, {
                excludeBookingId: existingBooking.id,
            })

            const intent = await intentForMode(
                { ...existingBooking, stripe_payment_intent_id: existingBooking.stripe_payment_intent_id },
                data.paymentMode ?? 'card',
            )
            return {
                clientSecret: intent.client_secret,
                bookingId: existingBooking.id,
                totalPrice: Number(existingBooking.total_price),
            }
        }

        const start = new Date(data.startTime)
        const end = new Date(data.endTime)

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new Error('Invalid start or end time')
        }
        if (end <= start) {
            throw new Error('End time must be after start time')
        }
        if (!Number.isFinite(carIdNum)) {
            throw new Error('Invalid car id')
        }

        await assertCarIsAvailable(carIdNum, data.startTime, data.endTime)

        // Resolved before the quote because it can reject the whole booking: an
        // out-of-area delivery address should fail here, not after a Stripe
        // PaymentIntent has been created for it.
        const pickup = await resolvePickupOnServer(data)

        // The price is recomputed here rather than taken from data.totalPrice.
        // That value reaches us through URL search params the customer can edit,
        // so it's treated as a display hint only — quote.total is what Stripe
        // charges and what the booking row records. The pickup fee inside that
        // quote is subject to exactly the same rule.
        const quote = await quoteTripOnServer({
            carId: carIdNum,
            startDateLocal: data.startDateLocal,
            startTimeLocal: data.startTimeLocal,
            endDateLocal: data.endDateLocal,
            endTimeLocal: data.endTimeLocal,
            startTimeIso: data.startTime,
            endTimeIso: data.endTime,
            pickup,
        })

        // A mismatch is either tampering or genuine drift between the widget's
        // quote and the server's — both are worth seeing in the logs.
        if (Math.abs(quote.total - data.totalPrice) > 0.01) {
            console.warn(
                `[pricing] client/server total mismatch — charging server price. ` +
                `car=${carIdNum} user=${user.id} client=${data.totalPrice} server=${quote.total}`
            )
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(quote.total * 100),
            currency: 'usd',
            // Naming these suppresses Stripe's automatic payment methods, which
            // is what makes the card mode render as bare card fields instead of
            // a chooser listing every method enabled on the account.
            payment_method_types: PAYMENT_METHOD_TYPES[data.paymentMode ?? 'card'],
            metadata: {
                carId: data.carId,
                userId: user.id,
                startTime: data.startTime,
                endTime: data.endTime,
                pickupLocation: pickup.bookingLabel,
            },
        })

        // paymentIntent.client_secret can theoretically be null if the
        // payment intent is in a state that doesn't need one — guard it
        if (!paymentIntent.client_secret) {
            throw new Error('Failed to create payment intent')
        }

        const { data: booking, error } = await supabase
            .from('bookings')
            .insert({
                car_id: carIdNum,
                user_id: user.id,
                start_time: data.startTime,
                end_time: data.endTime,
                total_price: quote.total,
                // pickup.bookingLabel, not data.pickupLocation. Two reasons, and
                // the second is the important one:
                //
                // 1. For the home base this is the full street address, while the
                //    customer only ever saw "Saint Paul, MN 55105" — the exact
                //    address is deliberately withheld until a booking exists.
                // 2. It's a string this codebase produced from a verified id or a
                //    geocoded result. data.pickupLocation is whatever was in the
                //    URL, and it ends up on the admin reservation screen, in the
                //    confirmation page and in the host's trip list — none of which
                //    should be rendering unvalidated text from a query param.
                pickup_location: pickup.bookingLabel,
                stripe_payment_intent_id: paymentIntent.id,
                status: 'pending',
            })
            .select()
            .single()

        if (error) throw new Error(error.message)
        // After the null check above, TS now knows booking is not null
        return {
            clientSecret: paymentIntent.client_secret,
            bookingId: booking!.id,
            totalPrice: quote.total,
        }
    })

export const confirmBooking = createServerFn({ method: 'POST' })
    .inputValidator((input: {
        bookingId: string
        paymentIntentId: string
    }) => input)
    .handler(async ({ data }) => {
        const paymentIntent = await stripe.paymentIntents.retrieve(data.paymentIntentId)

        if (paymentIntent.status !== 'succeeded') {
            throw new Error('Payment not completed')
        }

        const supabaseAdmin = createClient(
            process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } }
        )

        const { data: booking, error } = await supabaseAdmin
            .from('bookings')
            .update({ status: 'confirmed' })
            .eq('id', data.bookingId)
            .eq('stripe_payment_intent_id', data.paymentIntentId)
            .select()
            .single()

        if (error) throw new Error(error.message)
        return booking
    })

export const cancelBooking = createServerFn({ method: 'POST' })
    .inputValidator((input: {
        bookingId: string
        // Nullable: bookings entered by hand for off-platform trips never had a
        // Stripe intent. Those are still cancellable, there's just nothing to
        // refund — see the guard on the refund call below.
        paymentIntentId: string | null
    }) => input)
    .handler(async ({ data }) => {
        const supabaseAdmin = createClient(
            process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } }
        )

        const { data: booking } = await supabaseAdmin
            .from('bookings')
            .select('status')
            .eq('id', data.bookingId)
            .single()

        // Only refund if was actually paid for, and only if there's an intent to
        // refund against — an off-platform booking has no Stripe side to reverse,
        // so it falls straight through to being marked canceled.
        if (booking?.status === 'confirmed' && data.paymentIntentId) {
            try {
                await stripe.refunds.create({
                    payment_intent: data.paymentIntentId,
                });
            } catch (err: any) {
                console.error("Stripe refund failed:", err.message);
                throw new Error("Could not process refund through Stripe.");
            }
        }

        if (booking?.status === 'pending') {
            await supabaseAdmin
                .from('bookings')
                .delete()
                .eq('id', data.bookingId)
        } else {
            await supabaseAdmin
                .from('bookings')
                .update({ status: 'canceled' })
                .eq('id', data.bookingId)
        }

        return { success: true }
})

export const getBookingById = createServerFn({ method: 'GET' })
    .inputValidator((bookingId: string) => bookingId)
    .handler(async ({ data: bookingId }) => {
        const supabase = getSupabaseServerClient()

        // trip_media(count) rides along so the reservation page can label the
        // Trip Photos section without a second round trip.
        const { data, error } = await supabase
            .from('bookings')
            .select('*, cars(*), profiles(*), trip_media(count)')
            .eq('id', bookingId)
            .single()

        if (error) throw new Error('Booking not found')
        return data
    })

// Fetches current user profile's row
export const getProfile = createServerFn({ method: 'GET' })
    .handler(async () => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single()

        return data // null if no profile row exists yet
    })

// ---- Profile ----------------------------------------------------------------------------

// Saves driver info to the profile.
// Uses upsert so it works whether the row exists or not.
export const saveDriverInfo = createServerFn({ method: 'POST' })
    .inputValidator((input: {
        fullName: string
        dateOfBirth: string
        email: string
        phone: string
        address: string
        city: string
        state: string
        zip: string
    }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { error } = await supabase
            .from('profiles')
            .upsert({
                id: user.id,
                full_name: data.fullName,
                date_of_birth: data.dateOfBirth,
                email: data.email,
                phone: data.phone,
                address: data.address,
                city: data.city,
                state: data.state,
                zip: data.zip,
            })

        if (error) throw new Error(error.message)
    })

// ---- Stripe ----------------------------------------------------------------------------

// Creates a Stripe Identity Verification Session.
// Stripe returns a URL — we redirect the user there for the actual scan.
// The `return_url` is where Stripe sends the user after they finish.
export const createIdentitySession = createServerFn({ method: 'POST' })
    .inputValidator((input: { returnUrl: string }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        // Check if user already has an identity session
        const { data: profile } = await supabase
            .from('profiles')
            .select('stripe_identity_session_id')
            .eq('id', user.id)
            .single()

        if(profile?.stripe_identity_session_id) {
            const existingSession = await stripe.identity.verificationSessions.retrieve(
                profile.stripe_identity_session_id
            )

            // 'requires_input' meaning user has not finished yet, return them to the same identity session id
            if (existingSession.status === 'requires_input' && existingSession.url) {
                return { url: existingSession.url, sessionId: existingSession.id }
            }
        }

        // Create the verification session with Stripe
        // 'document' type means license/passport scan + selfie match
        const session = await stripe.identity.verificationSessions.create({
            type: 'document',
            metadata: { userId: user.id },
            options: {
                document: {
                    // Only accept driver's licenses and ID cards, not passports
                    allowed_types: ['driving_license', 'id_card'],
                    require_live_capture: true,   // no uploaded photos
                    require_matching_selfie: true, // selfie must match document
                },
            },
            return_url: data.returnUrl,
        })

        // Store the session ID on the profile so the webhook can find this user
        await supabase
            .from('profiles')
            .update({ stripe_identity_session_id: session.id })
            .eq('id', user.id)

        // client_secret is what Stripe uses for its hosted verification modal
        return { url: session.url, sessionId: session.id }
    })

// Finalizes identity verification. Changes user's identity verification boolean to true if verified
export const finalizeIdentitySession = createServerFn({ method: 'POST' })
    .inputValidator((input: { sessionId: string }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()
        const auth = await supabase.auth.getUser()
        const user = auth.data.user
        if (!user) throw new Error('Not authenticated')

        // Retrieve status from Stripe
        const session = await stripe.identity.verificationSessions.retrieve(data.sessionId)

        if (session.status === 'verified') {
            const supabaseAdmin = createClient(
                process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                { auth: { persistSession: false, autoRefreshToken: false } }
            )

            await supabaseAdmin
                .from('profiles')
                .update({
                    identity_verified: true,
                    identity_verified_at: new Date().toISOString(),
                    stripe_identity_session_id: session.id
                })
                .eq('id', user.id)

            return { verified: true }
        }

        return { verified: false, status: session.status }
    })

// Fetches all confirmed, canceled, or completed bookings for the logged-in user
export const getUserBookings = createServerFn({ method: 'GET' })
    .handler(async () => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const supabaseAdmin = createClient(
            process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } }
        )

        // Delete abandoned booking sessions older than an hour
        await supabaseAdmin
            .from('bookings')
            .delete()
            .eq('user_id', user.id)
            .eq('status', 'pending')
            .lt('created_at', oneHourAgo)


        const { data, error } = await supabase
            .from('bookings')
            .select('*, cars(*)') // Joins the cars table
            .eq('user_id', user.id)
            .order('start_time', { ascending: false }) // Newest first

        if (error) throw new Error(error.message)
        return data || []
    })

// Fetches all confirmed bookings for every user
export const getConfirmedBookings = createServerFn({ method: 'GET' })
    .handler(async () => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: profile } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', user.id)
            .single()

        if (!profile?.is_admin) throw new Error('Not authorized')

        const { data, error } = await supabase
            .from('bookings')
            .select('*, cars(*), profiles(full_name, email, id)')
            .eq('status', 'confirmed')
            .order('start_time', { ascending: true })

        if (error) throw new Error(error.message)
        return data || []
    })

export const getTuroBookings = createServerFn({ method: 'GET' })
    .inputValidator((input: { startDate: string; endDate: string }) => input)
    .handler(async ({ data: range }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: profile } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', user.id)
            .single()

        if (!profile?.is_admin) throw new Error('Not authorized')

        const { data, error } = await supabase
            .from('turo_bookings')
            .select('*')
            .lte('start_time', range.endDate)
            .gte('end_time', range.startDate)
            .order('start_time', { ascending: true })

        if (error) throw new Error(error.message)
        return data || []
    })

// Fetches all past bookings for every user, bookings with the status completed or canceled
export const getPastBookings = createServerFn({ method: 'GET' })
    .handler(async () => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: profile } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', user.id)
            .single()

        if (!profile?.is_admin) throw new Error('Not authorized')

        const { data, error } = await supabase
            .from('bookings')
            .select('*, cars(*), profiles(full_name, email, id)')
            .in('status', ['completed', 'canceled'])
            .order('start_time', { ascending: true })

        if (error) throw new Error(error.message)
        return data || []
    })

// Fetches all price overrides for all cars within a date range
// Called in calendar.tsx loader alongside getCars and getCalendarBookings
export const getPriceOverrides = createServerFn({ method: 'GET' })
    .inputValidator((input: { startDate: string; endDate: string }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: profile } = await supabase
            .from('profiles').select('is_admin').eq('id', user.id).single()
        if (!profile?.is_admin) throw new Error('Not authorized')

        const { data: overrides, error } = await supabase
            .from('car_price_overrides')
            .select('car_id, date, price')
            .gte('date', data.startDate)
            .lte('date', data.endDate)

        if (error) throw new Error(error.message)
        return overrides || []
    })

// Upserts price overrides for multiple cells at once
// Uses supabase's upsert with onConflict so existing overrides for a
// car and date combination are updated rather than causing a duplicate error
export const upsertPriceOverrides = createServerFn({ method: 'POST' })
    .inputValidator((input: {
        overrides: { carId: number; date: string; price: number }[]
    }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: profile } = await supabase
            .from('profiles').select('is_admin').eq('id', user.id).single()
        if (!profile?.is_admin) throw new Error('Not authorized')

        const rows = data.overrides.map(o => ({
            car_id: o.carId,
            date: o.date,
            price: o.price,
            updated_at: new Date().toISOString(),
        }))

        const { error } = await supabase
            .from('car_price_overrides')
            .upsert(rows, { onConflict: 'car_id,date' })

        if (error) throw new Error(error.message)
        return { updated: rows.length }
    })

export const getBlockedDates = createServerFn({ method: 'GET' })
    .inputValidator((input: { startDate: string; endDate: string }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: profile } = await supabase
            .from('profiles').select('is_admin').eq('id', user.id).single()
        if (!profile?.is_admin) throw new Error('Not authorized')

        const { data: blocked, error} = await supabase
            .from('car_blocked_dates')
            .select('id, car_id, start_date, end_date, reason, created_at')
            .lte('start_date', data.endDate)
            .gte('end_date', data.startDate)
        if (error) throw new Error(error.message)

        return blocked || []
    })

export const createBlockedDates = createServerFn({ method: 'POST' })
    .inputValidator((input: {
        blocks: { carId: number; startDate: string; endDate: string; reason?: string }[]
    }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: profile } = await supabase
            .from('profiles').select('is_admin').eq('id', user.id).single()
        if (!profile?.is_admin) throw new Error('Not authorized')

        const rows = data.blocks.map(b => ({
            car_id: b.carId,
            start_date: b.startDate,
            end_date: b.endDate,
            reason: b.reason ?? null,
        }))
        // .select() so the real uuids come back with the insert. Without it the
        // caller has no id to hand to deleteBlockedDate and has to invent one,
        // which then fails the uuid cast on the way back in.
        const { data: inserted, error } = await supabase
            .from('car_blocked_dates')
            .insert(rows)
            .select('id, car_id, start_date, end_date, reason, created_at')

        if (error) throw new Error(error.message)
        return { created: inserted?.length ?? 0, blocks: inserted ?? [] }
    })

export const deleteBlockedDate = createServerFn({ method: 'POST' })
    .inputValidator((blockId: string) => blockId)
    .handler(async ({ data: blockId }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: profile } = await supabase
            .from('profiles').select('is_admin').eq('id', user.id).single()
        if (!profile?.is_admin) throw new Error('Not authorized')

        // Ask for the deleted row back and treat an empty result as
        // the failure it is. Since a delete that matches nothing is not an error in Supabase
        const { data: deleted, error } = await supabase
            .from('car_blocked_dates')
            .delete()
            .eq('id', blockId)
            .select('id')
        if (error) throw new Error(error.message)
        if (!deleted || deleted.length === 0) throw new Error('Block not found or already removed')
        return { deleted: blockId }
    })

export const getAvailableCars = createServerFn({ method: 'GET' })
    .inputValidator((input: { start?: string; end?: string }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()

        if (data.start && data.end) {
            const { data: rows, error } = await supabase.rpc('get_available_cars', {
                start_ts: data.start,
                end_ts: data.end,
            })
            if (error) throw new Error(error.message)
            return rows ?? []
        }

        const { data: rows, error } = await supabase
            .from('cars')
            .select('*')
            .eq('is_available', true)
            .order('price_per_day', { ascending: true })
            .order('make', { ascending: true })
            .order('model', { ascending: true })
            .order('year', { ascending: true })

        if (error) throw new Error(error.message)
        return rows ?? []
    })

export const syncTuroBookings = createServerFn({ method: 'POST' })
    .handler(async () => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: profile } = await supabase
            .from('profiles').select('is_admin').eq('id', user.id).single()
        if (!profile?.is_admin) throw new Error('Not authorized')

        // Initialize Gmail client using stored refresh token
        const oauth2Client = new google.auth.OAuth2(
            process.env.GMAIL_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET,
        )
        oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN })
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

        // Fetch all cars so we can match email car names to car IDs
        const { data: cars } = await supabase.from('cars').select('id, make, model, year')
        if (!cars) throw new Error('Could not load cars')

        // Fetch already-synced message IDs so we never insert duplicates.
        // The gmail_message_id unique constraint handles this at the DB level too,
        // but checking here avoids unnecessary API calls for emails we've seen.
        const { data: existing } = await supabase
            .from('turo_bookings')
            .select('gmail_message_id')
        const alreadySynced = new Set(existing?.map(r => r.gmail_message_id) ?? [])

        // Search for Turo booking + cancellation emails from the past ~13 months.
        // "trip with your" matches both "X's trip with your Y is booked!" and
        // "X has cancelled their trip with your Y" — which type each message
        // actually is gets decided below via its Notification-Name header.
        // (Previously also required "Cha-ching" in the body, which matched
        // booking emails only and silently excluded every cancellation.)
        // Paginated via pageToken since a single list() call only returns one
        // page — without this, any matches past the first page were silently
        // dropped. alreadySynced (above) keeps this cheap: we only ever fetch
        // and parse the bodies of messages we haven't stored yet.
        const messageIds: string[] = []
        let pageToken: string | undefined = undefined
        do {
            // Typed loosely (matches findPlainText/payload below) — the googleapis
            // Gmail client's overloads otherwise fight TS across this loop.
            const listRes: any = await gmail.users.messages.list({
                userId: 'me',
                q: 'from:@turo.com subject:"trip with your" newer_than:400d',
                pageToken,
            })
            const ids: string[] = (listRes.data.messages ?? [])
                .map((m: { id?: string }) => m.id)
                .filter((id: string | undefined): id is string => !!id)
            messageIds.push(...ids)
            pageToken = listRes.data.nextPageToken ?? undefined
        } while (pageToken)

        // Filter out already-synced messages before fetching their content
        const newIds = messageIds.filter(id => !alreadySynced.has(id!)) as string[]

        if (newIds.length === 0) {
            return { synced: 0, skipped: messageIds.length, canceled: 0, errors: [] }
        }

        const results = { synced: 0, skipped: messageIds.length - newIds.length, canceled: 0, errors: [] as string[] }

        // Reservation IDs seen as canceled during this run. Deletions are applied
        // in one batch AFTER the loop below (not inline as each cancellation email
        // is seen) so that a booking and its cancellation landing in the same sync
        // run — e.g. on a big catch-up run — can't race: the cancellation always
        // wins regardless of which of the two messages Gmail happens to return first.
        const canceledTripIds: string[] = []

        // ── Convert parsed date parts to UTC ISO string ───────────────
        // Input: month, day, 2-digit year, hour, minute, am/pm
        // Output: UTC ISO string suitable for Supabase timestamptz column
        function toISO(month: string, day: string, year2: string, hour: string, min: string, ampm: string): string {
            let h = parseInt(hour)
            if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12
            if (ampm.toLowerCase() === 'am' && h === 12) h = 0
            const fullYear = 2000 + parseInt(year2)

            // Turo prints times in the host's local timezone, i.e. business time.
            //
            // This used to build a suffix-less string and hand it to `new Date()`,
            // relying on the host interpreting it as CST/CDT. That holds on a
            // developer's laptop and is wrong everywhere this actually runs: a
            // server function runs on the server, whose clock is UTC in
            // production, so every synced Turo trip was stored 5–6 hours early.
            // wallClockToUtcIso names the zone instead of inheriting it, and
            // gives the same answer wherever it runs.
            const dateKey = `${fullYear}-${String(parseInt(month)).padStart(2,'0')}-${String(parseInt(day)).padStart(2,'0')}`
            return wallClockToUtcIso(dateKey, `${String(h).padStart(2,'0')}:${min}`)
        }

        // Recursively find the plain text MIME part.
        // Gmail emails are a tree of MIME parts — an email might be:
        // multipart/mixed → multipart/alternative → text/plain
        //                                         → text/html
        // We walk the tree until we find mimeType === 'text/plain'
        function findPlainText(payload: any): string | null {
            if (!payload) return null
            if (payload.mimeType === 'text/plain' && payload.body?.data) {
                // Gmail encodes bodies as base64url — Buffer decodes it
                return Buffer.from(payload.body.data, 'base64').toString('utf-8')
            }
            for (const part of (payload.parts ?? [])) {
                const found = findPlainText(part)
                if (found) return found
            }
            return null
        }

        for (const messageId of newIds) {
            try {
                // Fetch the full email content for this message
                const message = await gmail.users.messages.get({
                    userId: 'me',
                    id: messageId,
                    format: 'full',
                })

                const headers = message.data.payload?.headers ?? []
                const headerValue = (name: string) => headers.find((h: any) => h.name === name)?.value ?? null

                // Turo tags every trip-related email with this header — it's how we
                // tell a booking confirmation apart from a cancellation notice
                // without depending on subject-line wording.
                const notificationName = headerValue('Notification-Name')

                if (notificationName === 'CancelledReservationOwner') {
                    // Cancellations carry the same Reservation-ID header as the
                    // original booking email, which is what ties the two together
                    // (they're otherwise unrelated Gmail messages with different IDs).
                    let turoTripId = headerValue('Reservation-ID')

                    // Some cancellation emails don't carry that header — fall back
                    // to the same "Reservation ID #12345" body text the booking
                    // path already parses, rather than silently dropping the
                    // cancellation and leaving a stale booking on the calendar.
                    if (!turoTripId) {
                        const body = findPlainText(message.data.payload)
                        const reservationMatch = body?.match(/Reservation ID #(\d+)/)
                        turoTripId = reservationMatch?.[1] ?? null
                    }

                    if (!turoTripId) {
                        results.errors.push(`${messageId}: cancellation missing Reservation-ID (header + body)`)
                        continue
                    }
                    canceledTripIds.push(turoTripId)
                    continue
                }

                const body = findPlainText(message.data.payload)
                if (!body) {
                    results.errors.push(`${messageId}: no plain text body found`)
                    continue
                }

                if (!body.includes('Trip start:') || !body.includes('Trip end:')) {
                    results.errors.push(`${messageId}: missing date fields, skipping`)
                    continue
                }

                // ── Parse start time ──────────────────────────────────────────
                // Matches: "Trip start: 8/23/26 9:30 am"
                const startMatch = body.match(
                    /Trip start:\s*(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i
                )
                // ── Parse end time ────────────────────────────────────────────
                // Matches: "Trip end: 8/26/26 9:00 pm"
                const endMatch = body.match(
                    /Trip end:\s*(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i
                )

                if (!startMatch || !endMatch) {
                    results.errors.push(`${messageId}: could not parse dates`)
                    continue
                }

                const startTime = toISO(startMatch[1]!, startMatch[2]!, startMatch[3]!, startMatch[4]!, startMatch[5]!, startMatch[6]!)
                const endTime = toISO(endMatch[1]!, endMatch[2]!, endMatch[3]!, endMatch[4]!, endMatch[5]!, endMatch[6]!)

                // Trip already over — nothing left to block on the calendar, and
                // widening the search window (400d) means most results are now
                // old completed trips, so skip storing them rather than let
                // turo_bookings accumulate rows nothing ever reads again.
                if (new Date(endTime).getTime() < Date.now()) {
                    results.skipped++
                    continue
                }

                // ── Parse car name ────────────────────────────────────────────
                // Matches a line like "Toyota Prius 2014" — make model year
                // The \d{4} anchors the match to lines containing a 4-digit year
                const carMatch = body.match(/^\s*((?:[\w-]+\s+)+\d{4})\s*$/m)
                const carString = carMatch?.[1]?.trim() ?? ''

                // Match the extracted car string to a car ID in our database.
                // Splits on the year, then checks make/model against each car.
                const yearMatch = carString.match(/(\d{4})/)
                const year = yearMatch ? parseInt(yearMatch[1]!) : 0
                const namePart = carString.replace(/\d{4}/, '').trim().toLowerCase()

                const matchedCar = cars.find(car =>
                    car.year === year &&
                    namePart.includes(car.make.toLowerCase())
                )

                if (!matchedCar) {
                    results.errors.push(`${messageId}: could not match car "${carString}"`)
                    continue
                }

                // ── Parse renter name ─────────────────────────────────────────
                // Matches "Zachary's trip is booked" at the start of the email
                const subject = message.data.payload?.headers
                    ?.find((h: any) => h.name === 'Subject')?.value ?? ''

                const renterMatch = subject.match(/^(.+?)[\u2019']s trip with your/)
                const renterName = renterMatch?.[1]?.trim() ?? null

                // ── Parse reservation ID ──────────────────────────────────────
                const reservationMatch = body.match(/Reservation ID #(\d+)/)
                const turoTripId = reservationMatch?.[1] ?? null

                // ── Insert into turo_bookings ─────────────────────────────────
                // gmail_message_id has a UNIQUE constraint so a second insert
                // of the same email is rejected at the DB level — safe to retry
                const { error } = await supabase
                    .from('turo_bookings')
                    .insert({
                        car_id: matchedCar.id,
                        gmail_message_id: messageId,
                        renter_name: renterName,
                        start_time: startTime,
                        end_time: endTime,
                        turo_trip_id: turoTripId,
                        raw_subject: subject || null
                    })

                if (error) {
                    // Unique constraint violation = already synced, just skip
                    if (error.code === '23505') {
                        results.skipped++
                    } else {
                        results.errors.push(`${messageId}: ${error.message}`)
                    }
                } else {
                    results.synced++
                }

            } catch (err: unknown) {
                results.errors.push(`${messageId}: ${err instanceof Error ? err.message : 'unknown error'}`)
            }
        }

        // Remove any booking whose reservation was canceled — applied once, after
        // the loop above, so cancellations always win over a same-run insert.
        if (canceledTripIds.length > 0) {
            const { data: removed, error: cancelErr } = await supabase
                .from('turo_bookings')
                .delete()
                .in('turo_trip_id', canceledTripIds)
                .select('id')

            if (cancelErr) {
                results.errors.push(`Failed to remove canceled bookings: ${cancelErr.message}`)
            } else {
                results.canceled = removed?.length ?? 0
            }
        }

        return results
    })

export const inspectTuroEmail = createServerFn({ method: 'GET' })
    .inputValidator((messageId: string) => messageId)
    .handler(async ({ data: messageId }) => {
        const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env
        if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
            throw new Error(
                'Missing Gmail envs: ' +
                (!GMAIL_CLIENT_ID ? 'GMAIL_CLIENT_ID ' : '') +
                (!GMAIL_CLIENT_SECRET ? 'GMAIL_CLIENT_SECRET ' : '') +
                (!GMAIL_REFRESH_TOKEN ? 'GMAIL_REFRESH_TOKEN ' : '')
            )
        }

        const oauth2Client = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET)
        oauth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN })
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

        try {
            const message = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })

            function decodeBody(data?: string | null): string | null {
                if (!data) return null
                // Gmail uses base64url. Normalize to base64 for Node.
                const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
                try {
                    return Buffer.from(normalized, 'base64').toString('utf-8')
                } catch (e) {
                    console.warn('Failed to decode body for message', messageId, e)
                    return null
                }
            }

            function findPlainText(payload: any): string | null {
                if (!payload) return null
                if (payload.mimeType === 'text/plain' && payload.body?.data) {
                    return decodeBody(payload.body.data)
                }
                if (payload.parts) {
                    for (const part of payload.parts) {
                        const result = findPlainText(part)
                        if (result) return result
                    }
                }
                return null
            }

            const subject = message.data.payload?.headers?.find(h => h.name === 'Subject')?.value
            const plainText = findPlainText(message.data.payload)

            return {
                subject,
                snippet: message.data.snippet,
                plainText: plainText?.slice(0, 3000) ?? null,
            }
        } catch (e: any) {
            console.error('inspectTuroEmail error:', e?.response?.data || e?.message || e)
            const err = e?.response?.data?.error || e?.message || 'Unknown Gmail error'
            const desc = e?.response?.data?.error_description
            throw new Error(desc ? `${err}: ${desc}` : err)
        }
    })

// ---- Trip media -------------------------------------------------------------------------

export const TRIP_MEDIA_BUCKET = 'trip-media'

// Signed read URLs are handed to the browser and used for the life of a page
// view. An hour outlasts any realistic session on the photos page.
const TRIP_MEDIA_URL_TTL_SECONDS = 60 * 60

type TripMediaKind = 'photo' | 'video'

function getServiceRoleClient() {
    return createClient(
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
    )
}

// Trip media is readable and writable by platform admins and by the renter on
// the booking. Every trip-media server function calls this itself: route-level
// admin auth does not cover server functions invoked directly, and the same
// check has to hold for the guest-facing view once it exists.
async function assertBookingAccess(bookingId: string) {
    const supabase = getSupabaseServerClient()
    const authResult = await supabase.auth.getUser()
    const user = authResult.data.user
    if (!user) throw new Error('Not authenticated')

    const { data: profile } = await supabase
        .from('profiles').select('is_admin').eq('id', user.id).single()

    const supabaseAdmin = getServiceRoleClient()
    const { data: booking, error } = await supabaseAdmin
        .from('bookings')
        .select('id, user_id')
        .eq('id', bookingId)
        .single()

    if (error || !booking) throw new Error('Booking not found')

    const isAdmin = Boolean(profile?.is_admin)
    if (!isAdmin && booking.user_id !== user.id) throw new Error('Not authorized')

    return { user, isAdmin, supabase, supabaseAdmin }
}

// Turns stored rows into rows the browser can render, by signing every full-size
// and thumbnail path in a single round trip.
async function withSignedUrls(supabaseAdmin: ReturnType<typeof getServiceRoleClient>, rows: any[]) {
    if (rows.length === 0) return []

    const paths = rows.flatMap(row =>
        row.thumb_path ? [row.storage_path, row.thumb_path] : [row.storage_path]
    )

    const { data: signed, error } = await supabaseAdmin
        .storage
        .from(TRIP_MEDIA_BUCKET)
        .createSignedUrls(paths, TRIP_MEDIA_URL_TTL_SECONDS)

    if (error) throw new Error(error.message)

    // createSignedUrls returns results in request order, but each entry also
    // carries its path, so match on that rather than trusting the ordering.
    const urlByPath = new Map<string, string>()
    for (const entry of signed ?? []) {
        if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl)
    }

    return rows.map(row => ({
        ...row,
        url: urlByPath.get(row.storage_path) ?? null,
        // Items whose thumbnail could not be generated (HEIC, odd codecs) fall
        // back to the full-size URL so the tile still renders.
        thumbUrl: (row.thumb_path ? urlByPath.get(row.thumb_path) : null)
            ?? urlByPath.get(row.storage_path)
            ?? null,
    }))
}

export const getTripMedia = createServerFn({ method: 'GET' })
    .inputValidator((bookingId: string) => bookingId)
    .handler(async ({ data: bookingId }) => {
        const { supabaseAdmin } = await assertBookingAccess(bookingId)

        const { data, error } = await supabaseAdmin
            .from('trip_media')
            .select('*, profiles:uploaded_by(full_name)')
            .eq('booking_id', bookingId)
            .order('created_at', { ascending: true })

        if (error) throw new Error(error.message)
        return withSignedUrls(supabaseAdmin, data ?? [])
    })

// Step one of the upload: hand the browser a signed URL per file so the bytes
// go straight to storage. Server functions serialize their input as JSON, so a
// 100-photo batch (let alone a video) can never be routed through one.
export const createTripMediaUploadUrls = createServerFn({ method: 'POST' })
    .inputValidator((input: {
        bookingId: string
        files: { ext: string; withThumb: boolean }[]
    }) => input)
    .handler(async ({ data }) => {
        const { supabaseAdmin } = await assertBookingAccess(data.bookingId)

        if (data.files.length === 0) return []
        if (data.files.length > 200) throw new Error('Too many files in one batch')

        return Promise.all(data.files.map(async file => {
            const id = crypto.randomUUID()
            // Extensions come from the browser; keep them to a safe shape so
            // they can't escape the booking's folder.
            const ext = file.ext.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'
            const path = `bookings/${data.bookingId}/${id}.${ext}`
            const thumbPath = file.withThumb ? `bookings/${data.bookingId}/thumbs/${id}.jpg` : null

            const storage = supabaseAdmin.storage.from(TRIP_MEDIA_BUCKET)

            const [full, thumb] = await Promise.all([
                storage.createSignedUploadUrl(path, { upsert: true }),
                thumbPath
                    ? storage.createSignedUploadUrl(thumbPath, { upsert: true })
                    : Promise.resolve(null),
            ])

            if (full.error) throw new Error(full.error.message)
            if (thumb?.error) throw new Error(thumb.error.message)

            return {
                id,
                path,
                token: full.data.token,
                thumbPath,
                thumbToken: thumb?.data.token ?? null,
            }
        }))
    })

// Step two: the browser confirms the bytes landed, and only then does a row
// appear. A failed upload leaves an orphaned object rather than a broken tile.
export const recordTripMedia = createServerFn({ method: 'POST' })
    .inputValidator((input: {
        bookingId: string
        items: {
            id: string
            kind: TripMediaKind
            storagePath: string
            thumbPath: string | null
            mimeType: string
            sizeBytes: number
            width: number | null
            height: number | null
            durationSeconds: number | null
        }[]
    }) => input)
    .handler(async ({ data }) => {
        const { user, supabaseAdmin } = await assertBookingAccess(data.bookingId)

        if (data.items.length === 0) return []

        const rows = data.items.map(item => {
            // Never trust a client-supplied path: rebuild it from the id so a
            // caller cannot write a row pointing at another booking's folder.
            const expectedPrefix = `bookings/${data.bookingId}/`
            if (!item.storagePath.startsWith(expectedPrefix)) {
                throw new Error('Invalid storage path')
            }
            if (item.thumbPath && !item.thumbPath.startsWith(expectedPrefix)) {
                throw new Error('Invalid thumbnail path')
            }

            return {
                id: item.id,
                booking_id: data.bookingId,
                kind: item.kind,
                storage_path: item.storagePath,
                thumb_path: item.thumbPath,
                mime_type: item.mimeType,
                size_bytes: item.sizeBytes,
                width: item.width,
                height: item.height,
                duration_seconds: item.durationSeconds,
                uploaded_by: user.id,
            }
        })

        const { data: inserted, error } = await supabaseAdmin
            .from('trip_media')
            .insert(rows)
            .select('*, profiles:uploaded_by(full_name)')

        if (error) throw new Error(error.message)
        return withSignedUrls(supabaseAdmin, inserted ?? [])
    })

export const updateTripMediaCaption = createServerFn({ method: 'POST' })
    .inputValidator((input: { mediaId: string; caption: string }) => input)
    .handler(async ({ data }) => {
        const supabaseAdmin = getServiceRoleClient()

        const { data: media, error: findErr } = await supabaseAdmin
            .from('trip_media')
            .select('booking_id')
            .eq('id', data.mediaId)
            .single()

        if (findErr || !media) throw new Error('Photo not found')
        await assertBookingAccess(media.booking_id)

        const caption = data.caption.trim().slice(0, 200)

        const { error } = await supabaseAdmin
            .from('trip_media')
            .update({ caption: caption || null })
            .eq('id', data.mediaId)

        if (error) throw new Error(error.message)
        return { caption: caption || null }
    })

export const deleteTripMedia = createServerFn({ method: 'POST' })
    .inputValidator((mediaId: string) => mediaId)
    .handler(async ({ data: mediaId }) => {
        const supabaseAdmin = getServiceRoleClient()

        const { data: media, error: findErr } = await supabaseAdmin
            .from('trip_media')
            .select('booking_id, storage_path, thumb_path')
            .eq('id', mediaId)
            .single()

        if (findErr || !media) throw new Error('Photo not found')
        await assertBookingAccess(media.booking_id)

        const paths = [media.storage_path, media.thumb_path].filter(Boolean) as string[]
        const { error: removeErr } = await supabaseAdmin
            .storage
            .from(TRIP_MEDIA_BUCKET)
            .remove(paths)

        // A missing object should not strand the row — drop the row either way,
        // but surface anything else that went wrong.
        if (removeErr && !/not found/i.test(removeErr.message)) {
            throw new Error(removeErr.message)
        }

        const { error } = await supabaseAdmin.from('trip_media').delete().eq('id', mediaId)
        if (error) throw new Error(error.message)

        return { deleted: mediaId }
    })