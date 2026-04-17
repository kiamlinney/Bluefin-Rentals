import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe'

// Bridge for the Fleet Page
export const getCars = createServerFn({ method: 'GET' })
    .handler(async () => {
        const supabase = getSupabaseServerClient()
        const { data, error } = await supabase
            .from('cars')
            .select('*')
            .order('id', { ascending: true })

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
            .eq('id', carId)
            .single()

        if (error) throw new Error("Car not found")
        return data
    })

export const getBookedDates = createServerFn({ method: 'GET' })
    .inputValidator((carId: string) => carId)
    .handler(async ({ data: carId }) => {
        const supabase = getSupabaseServerClient();

        const { data, error } = await supabase
            .rpc('get_car_availability', { car_id_param: carId });

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
    }) => input)
    .handler(async ({ data }) => {
        const supabase = getSupabaseServerClient()
        const authResult = await supabase.auth.getUser()
        const user = authResult.data.user
        if (!user) throw new Error('Not authenticated')

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

export const getBookingById = createServerFn({ method: 'GET' })
    .inputValidator((bookingId: string) => bookingId)
    .handler(async ({ data: bookingId }) => {
        const supabase = getSupabaseServerClient()

        const { data, error } = await supabase
            .from('bookings')
            .select('*, cars(*)')
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

        const { data, error } = await supabase
            .from('bookings')
            .select('*, cars(*)') // Joins the cars table automatically!
            .eq('user_id', user.id)
            .neq('status', 'pending') // Hides abandoned checkouts
            .order('start_time', { ascending: false }) // Newest first

        if (error) throw new Error(error.message)
        return data || []
    })