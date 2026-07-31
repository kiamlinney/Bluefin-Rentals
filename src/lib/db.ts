import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe'
import { google } from 'googleapis'

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

        const { data, error } = await supabase
            .rpc('get_car_availability', { car_id_param: parseInt(carId, 10) });

        if (error) {
            console.error("Error fetching booked dates:", error);
            return [];
        }

        return data;
    });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as Stripe.StripeConfig['apiVersion'],
})

export const createCheckoutSession = createServerFn({ method: 'POST' })
    .inputValidator((input: {
        carId: string
        startTime: string
        endTime: string
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
                const intent = await stripe.paymentIntents.retrieve(existing.stripe_payment_intent_id)
                return { clientSecret: intent.client_secret, bookingId: existing.id }
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
        if (data.totalPrice < 0) {
            throw new Error('Total price must be non-negative')
        }
        if (!Number.isFinite(carIdNum)) {
            throw new Error('Invalid car id')
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(data.totalPrice * 100),
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
                total_price: data.totalPrice,
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

        // Search for Turo booking confirmation emails.
        // newer_than:365d ensures we only look at the past year.
        // The subject filter matches Turo's "X's trip is booked" format.
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            q: 'from:@turo.com subject:"trip with your" "Cha-ching" newer_than:30d',
            maxResults: 50,
        })

        const messageIds = listRes.data.messages?.map(m => m.id).filter(Boolean) ?? []

        // Filter out already-synced messages before fetching their content
        const newIds = messageIds.filter(id => !alreadySynced.has(id!)) as string[]

        if (newIds.length === 0) {
            return { synced: 0, skipped: messageIds.length, errors: [] }
        }

        const results = { synced: 0, skipped: messageIds.length - newIds.length, errors: [] as string[] }

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

        return results
    })
