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

        const blockedRanges = (blocked ?? []).map(b => ({
            start_time: `${b.start_date}T00:00:00`,
            end_time: `${b.end_date}T00:00:00`,
        }))

        return [...(data ?? []), ...blockedRanges, ...(turo ?? [])];
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

// Authoritative server-side conflict check for a car/date-range, checked before
// a new booking is created. Uses the service-role client because a regular
// customer's RLS-scoped client can't see other users' bookings, or
// car_blocked_dates/turo_bookings at all (those are admin-only tables).
async function assertCarIsAvailable(carId: number, startTime: string, endTime: string) {
    const supabaseAdmin = createClient(
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // Other site bookings: confirmed always blocks; pending only blocks while
    // still "live" (mirrors the 1-hour stale-pending cleanup in getUserBookings)
    const holdCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data: conflictingBookings, error: bErr } = await supabaseAdmin
        .from('bookings')
        .select('id')
        .eq('car_id', carId)
        .in('status', ['pending', 'confirmed'])
        .lt('start_time', endTime)
        .gt('end_time', startTime)
        .or(`status.eq.confirmed,created_at.gte.${holdCutoff}`)
    if (bErr) throw new Error(bErr.message)
    if (conflictingBookings?.length) throw new Error('This car is no longer available for the selected dates')

    const startDate = startTime.slice(0, 10)
    const endDate = endTime.slice(0, 10)
    const { data: conflictingBlocks, error: blErr } = await supabaseAdmin
        .from('car_blocked_dates')
        .select('id')
        .eq('car_id', carId)
        .lte('start_date', endDate)
        .gte('end_date', startDate)
    if (blErr) throw new Error(blErr.message)
    if (conflictingBlocks?.length) throw new Error('This car is not available for the selected dates')

    const { data: conflictingTuro, error: tErr } = await supabaseAdmin
        .from('turo_bookings')
        .select('id')
        .eq('car_id', carId)
        .lt('start_time', endTime)
        .gt('end_time', startTime)
    if (tErr) throw new Error(tErr.message)
    if (conflictingTuro?.length) throw new Error('This car is not available for the selected dates')
}

const MS_PER_HOUR = 60 * 60 * 1000

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
        pickupLocation: string
        bookingId?: string // optional
    }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

        // If we have bookingId, use directly
        if (data.bookingId) {
            const { data: existing } = await supabase
                .from('bookings')
                .select('*')
                .eq('id', data.bookingId)
                .eq('status', 'pending')
                .maybeSingle()

            if (existing) {
                // No re-pricing here: this booking's total was computed server-side
                // when it was created, and its PaymentIntent is already locked to
                // that amount.
                const intent = await stripe.paymentIntents.retrieve(existing.stripe_payment_intent_id)
                return {
                    clientSecret: intent.client_secret,
                    bookingId: existing.id,
                    totalPrice: Number(existing.total_price),
                }
            }
        }

        const carIdNum = Number.parseInt(data.carId, 10)

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

        // If exists, retrieve existing Stripe intent instead of creating new one
        if (existingBooking) {
            const intent = await stripe.paymentIntents.retrieve(existingBooking.stripe_payment_intent_id)
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

        // The price is recomputed here rather than taken from data.totalPrice.
        // That value reaches us through URL search params the customer can edit,
        // so it's treated as a display hint only — quote.total is what Stripe
        // charges and what the booking row records.
        const quote = await quoteTripOnServer({
            carId: carIdNum,
            startDateLocal: data.startDateLocal,
            startTimeLocal: data.startTimeLocal,
            endDateLocal: data.endDateLocal,
            endTimeLocal: data.endTimeLocal,
            startTimeIso: data.startTime,
            endTimeIso: data.endTime,
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
            metadata: {
                carId: data.carId,
                userId: user.id,
                startTime: data.startTime,
                endTime: data.endTime,
                pickupLocation: data.pickupLocation,
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
                pickup_location: data.pickupLocation,
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
        paymentIntentId: string
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

        // Only refund if was actually paid for
        if (booking?.status === 'confirmed') {
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

        const { data, error } = await supabase
            .from('bookings')
            .select('*, cars(*), profiles(*)')
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
            .select('id, car_id, start_date, end_date, reason')
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
        const { error } = await supabase
            .from('car_blocked_dates')
            .insert(rows)

        if (error) throw new Error(error.message)
        return { created: rows.length }
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

        const { error } = await supabase.from('car_blocked_dates').delete().eq('id', blockId)
        if (error) throw new Error(error.message)
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
            // No "Z" suffix → new Date() treats this as local time (CST/CDT)
            // which is correct since Turo shows times in the host's local timezone
            const localStr = [
                `${fullYear}-${String(parseInt(month)).padStart(2,'0')}-${String(parseInt(day)).padStart(2,'0')}`,
                `T${String(h).padStart(2,'0')}:${min}:00`
            ].join('')
            return new Date(localStr).toISOString()
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