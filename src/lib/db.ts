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
    type TripQuote,
} from './pricing'
import { runTuroSync, TURO_SYNC_MAX_LOOKBACK_DAYS } from './turo-sync.server'
import { DEFAULT_BOOKING_RATE, type BookingRate } from './booking-rate.ts'
import { refundForCancellation } from './cancellation-policy.ts'
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
    buildAvailabilityMap,
    startableDayCount,
    toOccupiedSpans,
    type UnavailabilityRow,
} from './availability'
import { businessDateKey, formatBusinessDateTime } from './dates'
import {
    BOOKING_EMAIL_SELECT,
    notifyAdminBookingConfirmed,
    sendBookingConfirmedEmail,
} from './booking-email'
import { notifyBookingCanceled } from './cancellation-email'

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
        const viewerId = (await supabase.auth.getUser()).data.user?.id
        return loadUnavailabilityRows(supabase, createServiceRoleClient(), parseInt(carId, 10), viewerId)
    });

// This endpoint is public (no auth check), so car_blocked_dates and
// turo_bookings — both admin-only tables under RLS — are read with the
// service-role client. Only start/end are selected, never renter_name.
function createServiceRoleClient() {
    return createClient(
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
    )
}

// Everything that makes one car unavailable, tagged by source. It's the question
// both the booking calendar (getBookedDates) and the homepage's featured cars
// (getFeaturedCars) ask, and it lives in one place so the two can't disagree
// about which dates are open. The clients are passed in so getFeaturedCars can
// reuse one pair across every car rather than opening a pair per car.
async function loadUnavailabilityRows(
    supabase: ReturnType<typeof getSupabaseServerClient>,
    supabaseAdmin: ReturnType<typeof createServiceRoleClient>,
    carIdNum: number,
    viewerId: string | undefined,
): Promise<UnavailabilityRow[]> {
        const { data, error } = await supabase
            .rpc('get_car_unavailability', { car_id_param: carIdNum });

        if (error) {
            console.error("Error fetching booked dates:", error);
            return [];
        }

        // get_car_unavailability returns `confirmed` bookings only, but
        // assertCarIsAvailable also refuses a range held by a live `pending`
        // row — so a hold that the calendar can't see is a date shown as open
        // that fails at the payment step, and it "fixes itself" an hour later
        // when the hold lapses. The two have to be asked the same question.
        //
        // Held rows are read here rather than added to the RPC because the RPC
        // is SECURITY DEFINER and public: teaching it about holds would leak
        // in-progress checkouts to anonymous callers with no way to scope them
        // to a viewer. The service-role client is already open for the
        // admin-only tables, and only start/end leave this function.
        //
        // The viewer's own holds are deliberately excluded. They're already
        // invisible to them at checkout (see assertCarIsAvailable's viewerId),
        // and greying out the dates a customer is in the middle of booking
        // would read as the car being taken by someone else.
        const holdCutoff = new Date(Date.now() - PENDING_HOLD_MS).toISOString()

        let heldQuery = supabaseAdmin
            .from('bookings')
            .select('start_time, end_time')
            .eq('car_id', carIdNum)
            .eq('status', 'pending')
            .gte('created_at', holdCutoff)
        if (viewerId) heldQuery = heldQuery.neq('user_id', viewerId)

        const [{ data: blocked }, { data: turo }, { data: held }] = await Promise.all([
            supabaseAdmin
                .from('car_blocked_dates')
                .select('start_date, end_date')
                .eq('car_id', carIdNum),
            supabaseAdmin
                .from('turo_bookings')
                .select('start_time, end_time')
                .eq('car_id', carIdNum),
            heldQuery,
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
            // Tagged 'booking' like a confirmed trip: a hold occupies the car
            // the same way, turnaround buffer included, for as long as it lasts.
            ...(held ?? []).map(b => ({
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
}

const FEATURED_CAR_COUNT = 3
const FEATURED_WINDOW_DAYS = 7

// The homepage's featured cars: the ones that could be picked up on the most of
// the next FEATURED_WINDOW_DAYS days (ties go to the cheaper car), then shown
// cheapest first. Availability goes through loadUnavailabilityRows and the
// calendar's own availability map, so a car featured as open is open on the car
// page too — holds, Turo trips, admin blocks and turnaround all included.
export const getFeaturedCars = createServerFn({ method: 'GET' })
    .handler(async () => {
        const supabase = getSupabaseServerClient()
        const { data: cars, error } = await supabase
            .from('cars')
            .select('*')
            .eq('is_available', true)

        if (error) throw new Error(error.message)
        if (!cars || cars.length === 0) return []

        const supabaseAdmin = createServiceRoleClient()
        const viewerId = (await supabase.auth.getUser()).data.user?.id
        const now = new Date()
        const todayKey = todayInBusinessTz(now)
        const price = (car: (typeof cars)[number]) => Number(car.price_per_day)
        // id breaks price ties. 
        const cheaper = (a: (typeof cars)[number], b: (typeof cars)[number]) =>
            price(a) - price(b) || a.id - b.id

        const ranked = await Promise.all(
            cars.map(async car => {
                const rows = await loadUnavailabilityRows(supabase, supabaseAdmin, car.id, viewerId)
                const map = buildAvailabilityMap(toOccupiedSpans(rows))
                return { car, openDays: startableDayCount(map, todayKey, FEATURED_WINDOW_DAYS, now) }
            }),
        )

        return ranked
            .filter(r => r.openDays > 0)
            .sort((a, b) => b.openDays - a.openDays || cheaper(a.car, b.car))
            .slice(0, FEATURED_CAR_COUNT)
            .map(r => r.car)
            .sort(cheaper)
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

// How long a `pending` booking holds the car while its owner is at the payment
// step. After this the row is abandoned: it stops blocking, and getUserBookings
// deletes it on that user's next visit.
//
// Read by all three places that have to agree on what "held" means —
// assertCarIsAvailable (the enforcement point), getBookedDates (what the
// calendar greys out) and the cleanup in getUserBookings. It lives here as one
// constant because it drifting apart is precisely how a customer ends up
// picking a date the calendar showed as open and being refused at checkout.
const PENDING_HOLD_MS = 60 * 60 * 1000

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
//
// `viewerId` widens that same idea from one row to one customer. A pending row
// is a soft hold on an unfinished checkout, and holding a car against the very
// person trying to book it is never useful: change the dates by an hour and the
// abandoned row refuses the new range, with the turnaround buffer making it
// refuse three hours either side too. The dedup query below only rescues the
// case where the range matches exactly. Other customers' holds still block, and
// `confirmed` still blocks unconditionally — including the viewer's own, since
// a paid trip is a real trip no matter who booked it.
async function assertCarIsAvailable(
    carId: number,
    startTime: string,
    endTime: string,
    options: { excludeBookingId?: string; viewerId?: string } = {},
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
    // still "live", and never against the customer who owns it (see viewerId).
    const holdCutoff = new Date(Date.now() - PENDING_HOLD_MS).toISOString()
    const liveHold = options.viewerId
        ? `and(created_at.gte.${holdCutoff},user_id.neq.${options.viewerId})`
        : `created_at.gte.${holdCutoff}`
    let bookingQuery = supabaseAdmin
        .from('bookings')
        .select('start_time, end_time')
        .eq('car_id', carId)
        .in('status', ['pending', 'confirmed'])
        .lt('start_time', windowEnd)
        .gt('end_time', windowStart)
        .or(`status.eq.confirmed,${liveHold}`)
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
    bookingRate: BookingRate
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
        bookingRate: input.bookingRate,
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
    const amount = Math.round(Number(booking.total_price) * 100)

    const existing = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id)

    // Both halves matter. The mode decides which methods the Element offers;
    // the amount decides what the customer is charged.
    //
    // The amount check is not paranoia — it's load-bearing since the booking
    // rate arrived. That's the one checkout input that re-prices a booking
    // *after* the row exists, and without this an intent created for the
    // non-refundable total would be handed back unchanged for a refundable
    // booking: the customer picks the flexible option and is quietly charged
    // the cheaper one. The row is the source of truth; this makes the intent
    // agree with it.
    if (intentMatchesMode(existing, mode) && existing.amount === amount) return existing

    const replacement = await stripe.paymentIntents.create({
        // Copied from the row, which the caller has already re-priced if it
        // needed re-pricing. This function reconciles the intent to the row; it
        // never re-quotes on its own.
        amount,
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
        // Which cancellation terms the trip is priced under. Optional for the
        // same back-compat reason as paymentMode — an in-flight checkout during
        // a deploy falls back to the anchor rate rather than failing, and the
        // anchor is the cheaper of the two, so the fallback can never overcharge.
        bookingRate?: BookingRate
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
                    { excludeBookingId: existing.id, viewerId: user.id },
                )

                // No re-pricing here, unlike the dedup path below. This row was
                // reached by id rather than by matching the trip range, so
                // `data` needn't describe it — the comment above says as much —
                // and re-quoting from fields that may belong to a different trip
                // would be worse than not re-quoting at all.
                //
                // The consequence is that a rate toggle on a resumed booking
                // can't be honoured here, so the row's own rate is returned and
                // the client snaps its selection back to it. Showing the truth
                // beats silently pricing one rate and booking another.
                const intent = await intentForMode(
                    { ...existing, stripe_payment_intent_id: existing.stripe_payment_intent_id },
                    data.paymentMode ?? 'card',
                )
                return {
                    clientSecret: intent.client_secret,
                    bookingId: existing.id,
                    totalPrice: Number(existing.total_price),
                    bookingRate: existing.booking_rate as BookingRate,
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
                viewerId: user.id,
            })

            // Re-price when the customer has changed the booking rate since this
            // pending row was created.
            //
            // The dedup query above matches on car, user and the exact trip
            // range — deliberately not on the rate, since one customer picking
            // between two rates for one trip should not leave two pending rows
            // holding the same car. But that means this row can be priced for a
            // rate the customer is no longer choosing, and returning its stored
            // total was exactly the bug: pick Refundable, see the non-refundable
            // price, get charged it, and end up with a non-refundable booking.
            //
            // Safe to re-quote from `data` here specifically because the query
            // matched on data.startTime/endTime, so the request describes this
            // very row's trip. (The bookingId path above has no such guarantee,
            // which is why it doesn't do this.)
            const requestedRate = data.bookingRate ?? DEFAULT_BOOKING_RATE

            let bookingRow = existingBooking
            if (existingBooking.booking_rate !== requestedRate) {
                const pickup = await resolvePickupOnServer(data)
                const requote = await quoteTripOnServer({
                    carId: carIdNum,
                    startDateLocal: data.startDateLocal,
                    startTimeLocal: data.startTimeLocal,
                    endDateLocal: data.endDateLocal,
                    endTimeLocal: data.endTimeLocal,
                    startTimeIso: data.startTime,
                    endTimeIso: data.endTime,
                    pickup,
                    bookingRate: requestedRate,
                })

                // The row is updated before the intent is reconciled, because
                // intentForMode reads the amount off the row — see there.
                const { data: repriced, error: repriceErr } = await supabase
                    .from('bookings')
                    .update({
                        total_price: requote.total,
                        booking_rate: requote.bookingRate,
                        pickup_location: pickup.bookingLabel,
                        // Moves with total_price, always. The snapshot is
                        // immutable once the trip is paid for, but this row is
                        // still `pending` and being re-quoted — leaving the old
                        // breakdown here would describe a rate the guest just
                        // switched away from, and every refund computed from it
                        // would be wrong by the premium.
                        price_quote: { version: 1, ...requote },
                    })
                    .eq('id', existingBooking.id)
                    .eq('status', 'pending')
                    .select()
                    .single()

                if (repriceErr) throw new Error(repriceErr.message)
                bookingRow = repriced
            }

            const intent = await intentForMode(
                { ...bookingRow, stripe_payment_intent_id: existingBooking.stripe_payment_intent_id },
                data.paymentMode ?? 'card',
            )
            return {
                clientSecret: intent.client_secret,
                bookingId: bookingRow.id,
                totalPrice: Number(bookingRow.total_price),
                bookingRate: bookingRow.booking_rate as BookingRate,
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

        await assertCarIsAvailable(carIdNum, data.startTime, data.endTime, {
            viewerId: user.id,
        })

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
            bookingRate: data.bookingRate ?? DEFAULT_BOOKING_RATE,
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
                // Stored alongside total_price because the total alone can't say
                // which terms produced it, and the cancellation the guest was
                // promised depends on that.
                booking_rate: quote.bookingRate,
                // The whole quote, kept because total_price cannot be divided
                // back into days: discount tiers, the same-day surcharge and
                // per-date overrides all mean total/days is not what any
                // particular day cost — and a partial refund retains exactly
                // "one day's average cost".
                //
                // Written once and never updated. See the migration: this is a
                // snapshot of what the guest agreed to, not a cache of what the
                // price list currently says.
                price_quote: { version: 1, ...quote },
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
            bookingRate: quote.bookingRate,
        }
    })

export const confirmBooking = createServerFn({ method: 'POST' })
    .inputValidator((input: {
        bookingId: string
        paymentIntentId: string
    }) => input)
    .handler(async ({ data }) => {
        // Already self-limiting — the update below only matches a row whose
        // stored intent is the one Stripe just confirmed as succeeded — but
        // every other booking-scoped function authorizes, so this one does too.
        const { supabaseAdmin } = await assertBookingAccess(data.bookingId)

        const paymentIntent = await stripe.paymentIntents.retrieve(data.paymentIntentId)

        if (paymentIntent.status !== 'succeeded') {
            throw new Error('Payment not completed')
        }

        const { data: booking, error } = await supabaseAdmin
            .from('bookings')
            .update({ status: 'confirmed' })
            .eq('id', data.bookingId)
            .eq('stripe_payment_intent_id', data.paymentIntentId)
            .select()
            .single()

        if (error) throw new Error(error.message)

        // The third confirmation path, so it notifies too. Whichever of the
        // three gets here first sends; the others find the claim taken and do
        // nothing. Never throws, so a mail failure can't fail the confirmation.
        await notifyAdminBookingConfirmed(supabaseAdmin, data.bookingId)

        return booking
    })

// Re-sends the admin booking email for an existing booking, ignoring
// admin_notified_at. Exists so the template can be checked without paying for a
// trip. Admin-only and checked here rather than at the route: server functions
// are callable directly.
export const sendTestBookingEmail = createServerFn({ method: 'POST' })
    .inputValidator((input: { bookingId: string }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: profile } = await supabase
            .from('profiles').select('is_admin').eq('id', user.id).single()
        if (!profile?.is_admin) throw new Error('Not authorized')

        const supabaseAdmin = getServiceRoleClient()
        const { data: booking, error } = await supabaseAdmin
            .from('bookings')
            .select(BOOKING_EMAIL_SELECT)
            .eq('id', data.bookingId)
            .single()

        if (error || !booking) throw new Error('Booking not found')

        // Unlike notifyAdminBookingConfirmed this one throws, so a broken
        // refresh token or malformed template surfaces to whoever is testing.
        await sendBookingConfirmedEmail(booking as any, { isTest: true })
        return { sent: true }
    })

// A free-text reason is the one thing a guest can add, so it's the one thing
// bounded here. Stored verbatim and escaped at render — it reaches the host's
// inbox, so it is never interpolated raw.
const MAX_CANCELLATION_REASON = 500

function normalizeReason(reason: string | undefined): string | null {
    const trimmed = (reason ?? '').trim()
    return trimmed ? trimmed.slice(0, MAX_CANCELLATION_REASON) : null
}

// The paymentIntentId the caller used to pass is gone on purpose. This function
// runs as the service role and issues real refunds, so it takes exactly one
// thing from the client — which booking, plus an optional reason — and reads
// everything it acts on from the row itself. In particular the refund amount is
// derived here and never accepted from the browser.
//
// ── Why the order below is the order below ───────────────────────────────────
//
// The old version refunded first and updated the row afterwards, without
// checking whether the update succeeded. That leaves the worst possible failure
// available: money returned to the guest against a booking still marked
// confirmed, holding the car, with no record that anything happened.
//
// So the row transition is claimed FIRST, conditionally, and the refund follows.
// If the refund then fails the claim is released and the error surfaces — the
// guest sees a retryable failure instead of a silently half-finished
// cancellation. The idempotency key means that retry cannot double-refund.
export const cancelBooking = createServerFn({ method: 'POST' })
    .inputValidator((input: { bookingId: string; reason?: string }) => input)
    .handler(async ({ data }) => {
        // Admin, or the renter on this booking. Without this, knowing a booking
        // UUID was enough to cancel the trip and refund the charge.
        const { isAdmin, supabaseAdmin } = await assertBookingAccess(data.bookingId)

        const { data: existing, error: readErr } = await supabaseAdmin
            .from('bookings')
            .select('status, stripe_payment_intent_id, booking_rate, created_at, start_time, end_time, total_price, price_quote')
            .eq('id', data.bookingId)
            .single()

        if (readErr) throw new Error(readErr.message)
        if (!existing) throw new Error('Booking not found')

        // Decided before the claim so the refund is computed against the state
        // the caller actually saw, and so an un-cancellable status fails without
        // having written anything.
        const outcome = refundForCancellation({
            rate: (existing.booking_rate ?? DEFAULT_BOOKING_RATE) as BookingRate,
            bookedAt: new Date(existing.created_at),
            tripStart: new Date(existing.start_time),
            tripEnd: new Date(existing.end_time),
            quote: (existing.price_quote as TripQuote | null) ?? null,
            totalPaid: Number(existing.total_price),
            byAdmin: isAdmin,
        })

        // Claim the transition. Conditional on the status still being one we can
        // cancel, so two concurrent calls — a double-clicked button, a retried
        // request — cannot both proceed to the refund: Postgres serializes them
        // and only the first gets a row back. Same trick as the email claim in
        // notifyAdminBookingConfirmed.
        const { data: claimed, error: claimErr } = await supabaseAdmin
            .from('bookings')
            .update({
                status: 'canceled',
                canceled_at: new Date().toISOString(),
                canceled_by: isAdmin ? 'admin' : 'guest',
                cancellation_reason: normalizeReason(data.reason),
            })
            .eq('id', data.bookingId)
            .in('status', ['pending', 'confirmed'])
            .select('id, status')
            .maybeSingle()

        if (claimErr) throw new Error(claimErr.message)
        // Lost the race, or the booking was already canceled/completed. Not an
        // error: the caller's intent — this trip should not happen — already holds.
        if (!claimed) return { success: true, alreadyCanceled: true, outcome: null }

        const releaseClaim = async (to: 'pending' | 'confirmed') => {
            await supabaseAdmin
                .from('bookings')
                .update({ status: to, canceled_at: null, canceled_by: null, cancellation_reason: null })
                .eq('id', data.bookingId)
                .then(undefined, (e: any) =>
                    console.error('[cancel] failed to release claim:', e?.message))
        }

        // A pending row was never charged, so there is nothing to refund — but
        // its PaymentIntent is still payable, and a guest returning to a stale
        // checkout tab could pay for a trip that no longer exists. Cancel the
        // intent so that cannot happen.
        //
        // Note this row is marked, not deleted. Deleting it would orphan the
        // intent entirely: the webhook matches on payment intent id with no
        // status filter, so a surviving row is what lets a late payment heal
        // into a confirmed booking instead of vanishing. See CLAUDE.md.
        if (existing.status === 'pending') {
            if (existing.stripe_payment_intent_id) {
                try {
                    await stripe.paymentIntents.cancel(existing.stripe_payment_intent_id)
                } catch (err: any) {
                    // Already succeeded, already canceled, or otherwise not
                    // cancelable. Not fatal — the booking is canceled either way,
                    // and a succeeded intent will be reconciled by the webhook.
                    console.warn('[cancel] could not cancel payment intent:', err?.message)
                }
            }
            await notifyBookingCanceled(supabaseAdmin, data.bookingId, outcome)
            return { success: true, alreadyCanceled: false, outcome }
        }

        // Only refund against an intent that came from the row. A caller who
        // could name a payment intent could otherwise refund another booking's
        // charge. An off-platform booking has no Stripe side to reverse.
        if (outcome.kind !== 'none' && existing.stripe_payment_intent_id) {
            try {
                const refund = await stripe.refunds.create(
                    {
                        payment_intent: existing.stripe_payment_intent_id,
                        // Explicit for partials, and harmless for a full refund:
                        // Stripe refunds the remaining amount when it matches.
                        amount: Math.round(outcome.refundAmount * 100),
                    },
                    // Keyed on the booking, not the attempt, so a retry after a
                    // network failure returns the SAME refund rather than making
                    // a second one.
                    { idempotencyKey: `refund_${data.bookingId}` },
                )

                await supabaseAdmin
                    .from('bookings')
                    .update({ refund_id: refund.id, refunded_amount: outcome.refundAmount })
                    .eq('id', data.bookingId)
            } catch (err: any) {
                console.error('[cancel] Stripe refund failed:', err?.message)
                // Put the booking back the way it was. Better a retryable error
                // than a trip marked canceled that quietly kept the money.
                await releaseClaim('confirmed')
                throw new Error('Could not process refund through Stripe. Nothing was changed — please try again.')
            }
        }

        await notifyBookingCanceled(supabaseAdmin, data.bookingId, outcome)

        return { success: true, alreadyCanceled: false, outcome }
})

// Read-only companion to cancelBooking: what WOULD happen if this booking were
// cancelled right now.
//
// The dialog could compute this itself — refundForCancellation is isomorphic on
// purpose — but it would have to be handed created_at, booking_rate and the
// whole price_quote to do it, and those aren't all on the row the my-bookings
// list already loads. Asking the server keeps the quoted figure and the charged
// figure derived from the same place.
export const previewCancellation = createServerFn({ method: 'GET' })
    .inputValidator((input: { bookingId: string }) => input)
    .handler(async ({ data }) => {
        const { isAdmin, supabaseAdmin } = await assertBookingAccess(data.bookingId)

        const { data: booking, error } = await supabaseAdmin
            .from('bookings')
            .select('status, booking_rate, created_at, start_time, end_time, total_price, price_quote')
            .eq('id', data.bookingId)
            .single()

        if (error || !booking) throw new Error('Booking not found')

        const outcome = refundForCancellation({
            rate: (booking.booking_rate ?? DEFAULT_BOOKING_RATE) as BookingRate,
            bookedAt: new Date(booking.created_at),
            tripStart: new Date(booking.start_time),
            tripEnd: new Date(booking.end_time),
            quote: (booking.price_quote as TripQuote | null) ?? null,
            totalPaid: Number(booking.total_price),
            byAdmin: isAdmin,
        })

        // A pending row was never charged, so no refund figure should be shown
        // for it however the policy scores the dates.
        return {
            outcome: booking.status === 'pending'
                ? { ...outcome, kind: 'none' as const, refundAmount: 0, cancellationFee: 0, retainedPremium: 0 }
                : outcome,
            wasCharged: booking.status === 'confirmed',
            byAdmin: isAdmin,
        }
    })

// The profile columns the reservation and trip pages actually render. This was
// `profiles(*)`, which shipped the renter's date of birth, home address, and
// stripe_identity_session_id to the browser on every load — none of which any
// page displays. Widen it only alongside a matching change to
// BookingWithDetails in src/types.ts.
const BOOKING_PROFILE_COLUMNS =
    'id, full_name, email, phone, num_trips, created_at, identity_verified'

export const getBookingById = createServerFn({ method: 'GET' })
    .inputValidator((bookingId: string) => bookingId)
    .handler(async ({ data: bookingId }) => {
        // Authorize before reading rather than leaning on RLS. This function is
        // reachable directly as a server function, and it embeds another user's
        // profile — so "the policy would have blocked it" is not a defense worth
        // betting the renter's contact details on.
        const { supabaseAdmin } = await assertBookingAccess(bookingId)

        // trip_media(count) rides along so the reservation page can label the
        // Trip Photos section without a second round trip.
        const { data, error } = await supabaseAdmin
            .from('bookings')
            .select(`*, cars(*), profiles(${BOOKING_PROFILE_COLUMNS}), trip_media(count)`)
            .eq('id', bookingId)
            .single()

        if (error) throw new Error('Booking not found')
        return data
    })

// What the trip page is allowed to say about the money, as opposed to what the
// bookings row happens to hold. `unpaid` is the one worth naming: a `pending`
// row whose intent still wants a payment method is an abandoned checkout, not a
// failure, and it gets a "finish checkout" path rather than an error.
export type TripPaymentState =
    | 'confirmed'
    | 'processing'
    | 'unpaid'
    | 'failed'
    | 'canceled'
    | 'completed'

export type TripPaymentCard = {
    brand: string | null
    last4: string | null
    receiptUrl: string | null
}

// Terminal states are read off the row. Once a booking is canceled or completed,
// what the PaymentIntent says no longer changes what the page should show — and
// a refunded booking must never be talked back into looking confirmed.
function terminalStateOf(status: string): TripPaymentState | null {
    if (status === 'canceled') return 'canceled'
    if (status === 'completed') return 'completed'
    if (status === 'failed') return 'failed'
    return null
}

/**
 * Loader for the guest trip page. Same authorization as getBookingById, plus a
 * payment state that has actually been checked against Stripe rather than
 * inferred from the row.
 *
 * The row alone is not enough to render this page honestly: the webhook is the
 * source of truth for confirmation, and until it lands (or if it never does) a
 * paid booking still reads `pending`. The old booking-confirmed page skipped
 * this entirely and told everyone "You're all set!".
 */
export const getTripForGuest = createServerFn({ method: 'GET' })
    .inputValidator((bookingId: string) => bookingId)
    .handler(async ({ data: bookingId }) => {
        const { supabaseAdmin, isAdmin } = await assertBookingAccess(bookingId)

        const { data: booking, error } = await supabaseAdmin
            .from('bookings')
            .select(`*, cars(*), profiles(${BOOKING_PROFILE_COLUMNS}), trip_media(count)`)
            .eq('id', bookingId)
            .single()

        if (error || !booking) throw new Error('Booking not found')

        const terminal = terminalStateOf(booking.status)

        // Hand-entered off-platform bookings never had an intent, so there is
        // nothing to verify and nothing to put on a receipt.
        if (!booking.stripe_payment_intent_id) {
            return {
                booking,
                isAdmin,
                paymentState: terminal ?? (booking.status === 'confirmed' ? 'confirmed' : 'unpaid'),
                card: null as TripPaymentCard | null,
            }
        }

        let intent: Stripe.PaymentIntent
        try {
            // One retrieve serves both jobs: the status the page gates on, and
            // the card and receipt link the receipt block renders.
            intent = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id, {
                expand: ['latest_charge'],
            })
        } catch (err: any) {
            // Stripe being unreachable should not take the page down — the trip
            // details are still worth showing. Fall back to the row, which is
            // the pessimistic read.
            console.error('Could not retrieve PaymentIntent for booking', bookingId, err?.message)
            return {
                booking,
                isAdmin,
                paymentState: terminal ?? (booking.status === 'confirmed' ? 'confirmed' : 'processing'),
                card: null as TripPaymentCard | null,
            }
        }

        const charge = intent.latest_charge as Stripe.Charge | null
        const card: TripPaymentCard | null = charge
            ? {
                brand: charge.payment_method_details?.card?.brand ?? null,
                last4: charge.payment_method_details?.card?.last4 ?? null,
                receiptUrl: charge.receipt_url ?? null,
            }
            : null

        if (terminal) return { booking, isAdmin, paymentState: terminal, card }

        let paymentState: TripPaymentState
        switch (intent.status) {
            case 'succeeded':
                paymentState = 'confirmed'
                break
            case 'processing':
            case 'requires_action':
            case 'requires_confirmation':
            case 'requires_capture':
                paymentState = 'processing'
                break
            case 'requires_payment_method':
                paymentState = 'unpaid'
                break
            case 'canceled':
                paymentState = 'canceled'
                break
            default:
                paymentState = 'processing'
        }

        // The webhook normally does this. When it is late, delayed, or was never
        // delivered, the guest is sitting on the page watching a paid booking
        // claim to be pending — so close the gap here too. Still narrow enough
        // that it can never revive a row that genuinely moved on: `canceled`,
        // `failed` and `completed` are all excluded.
        //
        // `expired` is included on purpose. It means the hold was reaped as an
        // abandoned checkout — but Stripe is saying the money arrived, and a
        // paid trip is a real trip whatever housekeeping assumed. This is the
        // same repair the webhook performs by matching on the PaymentIntent id
        // alone, and it's why expire_stale_pending_bookings marks rows instead
        // of deleting them.
        const revivable = booking.status === 'pending' || booking.status === 'expired'
        if (paymentState === 'confirmed' && revivable) {
            const { error: updateErr } = await supabaseAdmin
                .from('bookings')
                .update({ status: 'confirmed' })
                .eq('id', bookingId)
                .in('status', ['pending', 'expired'])

            if (updateErr) {
                console.error('Could not confirm booking from trip page', bookingId, updateErr.message)
            } else {
                booking.status = 'confirmed'
            }
        }

        return { booking, isAdmin, paymentState, card }
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

// What the profile pages read. Deliberately narrower than `*`: is_admin, the
// home address and stripe_identity_session_id are all on this table and none of
// them are rendered, and the guest page serializes whatever comes back into the
// browser. Keep in step with UserProfileView in src/types.ts.
const PROFILE_VIEW_COLUMNS =
    'id, full_name, email, phone, date_of_birth, num_trips, created_at, identity_verified'

// Fetches one profile for the user profile pages. Two callers with different
// rights: the admin page at /admin/user/$userId reads anyone, the guest page at
// /profile reads only the caller.
//
// RLS already draws that line (profiles_select_owner_or_admin in schema.sql),
// but the check below is not redundant — server functions are callable directly,
// not just through a loader, and a policy that silently returns zero rows is a
// worse failure than an explicit throw.
export const getUserProfile = createServerFn({ method: 'GET' })
    .inputValidator((userId: string) => userId)
    .handler(async ({ data: userId }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: viewer } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', user.id)
            .single()

        const isAdminViewer = Boolean(viewer?.is_admin)
        if (!isAdminViewer && userId !== user.id) throw new Error('Not authorized')

        const { data, error } = await supabase
            .from('profiles')
            .select(PROFILE_VIEW_COLUMNS)
            .eq('id', userId)
            .maybeSingle()

        if (error) throw new Error(error.message)
        if (!data) throw new Error('User not found')

        return { profile: data, isAdminViewer }
    })

// Every booking a given user has made, newest first, for the trip history list
// on the admin profile page. Admin-only: the guest profile page never calls it,
// and /my-bookings already covers a user's view of their own trips.
export const getUserTripHistory = createServerFn({ method: 'GET' })
    .inputValidator((userId: string) => userId)
    .handler(async ({ data: userId }) => {
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
            .select('id, start_time, end_time, status, cars(id, year, make, model)')
            .eq('user_id', userId)
            .order('start_time', { ascending: false })

        if (error) throw new Error(error.message)
        return data || []
    })

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

        // The session id arrives from the browser, so being logged in is not
        // enough — without this, passing someone else's verified session id
        // marks your own profile as identity-verified. createIdentitySession
        // stamps metadata.userId at creation for exactly this check.
        if (session.metadata?.userId !== user.id) {
            throw new Error('Not authorized')
        }

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

        // This used to delete the caller's abandoned pending rows before
        // reading. That cleanup now lives in expire_stale_pending_bookings(),
        // run by pg_cron alongside auto_complete_bookings — it covers every
        // account rather than only whoever happened to open this page, and it
        // marks rows `expired` instead of deleting them, which is what keeps a
        // late payment from being charged against a booking that no longer
        // exists. See the migration for the full reasoning.
        //
        // Nothing here depended on that delete for correctness: a stale hold
        // stops blocking the car at read time (PENDING_HOLD_MS), not when the
        // row is reaped.
        const { data, error } = await supabase
            .from('bookings')
            .select('*, cars(*)') // Joins the cars table
            .eq('user_id', user.id)
            // An abandoned checkout isn't a trip. It's kept in the table so a
            // late payment can still find it, but showing someone a row per
            // tab they closed would make the list unreadable.
            .neq('status', 'expired')
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

// The Turo sync lives in turo-sync.server.ts 
export const syncTuroBookings = createServerFn({ method: 'POST' })
    .handler(async () => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        const { data: profile } = await supabase
            .from('profiles').select('is_admin').eq('id', user.id).single()
        if (!profile?.is_admin) throw new Error('Not authorized')

        // A manual run is the catch-up, so it searches the full window.
        return runTuroSync(supabase, TURO_SYNC_MAX_LOOKBACK_DAYS)
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

// Editing or removing one item is narrower than reading the set: booking access
// alone would let a renter delete the host's photos of the damage they caused.
// Admins act on anything; everyone else only on what they uploaded.
async function assertMediaOwnership(media: { booking_id: string; uploaded_by: string | null }) {
    const access = await assertBookingAccess(media.booking_id)

    if (!access.isAdmin && media.uploaded_by !== access.user.id) {
        throw new Error('Not authorized')
    }

    return access
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
            .select('booking_id, uploaded_by')
            .eq('id', data.mediaId)
            .single()

        if (findErr || !media) throw new Error('Photo not found')
        await assertMediaOwnership(media)

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
            .select('booking_id, storage_path, thumb_path, uploaded_by')
            .eq('id', mediaId)
            .single()

        if (findErr || !media) throw new Error('Photo not found')
        await assertMediaOwnership(media)

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