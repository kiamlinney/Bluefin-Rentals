import type { Database } from 'src/lib/database.types.ts'

export type Car = Database['public']['Tables']['cars']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']
export type CarPriceOverride = Database['public']['Tables']['car_price_overrides']['Row']
export type CarBlockedDate = Database['public']['Tables']['car_blocked_dates']['Row']

// --- Composite row types -----------------------------------------------------
//
// The generated Row types above describe a single table. They deliberately know
// nothing about embedded relations, so a query like
//
//     .select('*, cars(*), profiles(full_name, email, id)')
//
// hands back something wider than `Booking`, and assigning it to `Booking` fails.
// The types below model what those queries actually return. Each one names the
// server function it belongs to — if you change that function's `.select()`,
// change the matching type here too, or the mismatch resurfaces at the call site.

// Both embeds below are non-nullable, and that's load-bearing rather than
// optimistic: `bookings.car_id` and `bookings.user_id` are NOT NULL with FKs to
// cars/profiles (schema.sql:404, 409, both ON DELETE RESTRICT), so PostgREST
// always returns the related row. Typing them `| null` would force a pointless
// `?.` or a null branch at every read site for a case the schema forbids.

// getConfirmedBookings (db.ts:830) and getPastBookings (db.ts:883):
//     .select('*, cars(*), profiles(full_name, email, id)')
// Only three profile columns are requested, hence Pick<> rather than the whole
// row — promising callers a full Profile would be promising fields that aren't
// in the response.
export type BookingWithRelations = Booking & {
    cars: Car
    profiles: Pick<Profile, 'id' | 'full_name' | 'email'>
}

// getBookingById and getTripForGuest:
//     .select(`*, cars(*), profiles(${BOOKING_PROFILE_COLUMNS}), trip_media(count)`)
// Wider than the above on two counts: more profile columns, plus an aggregate.
// PostgREST returns `trip_media(count)` as an array holding a single { count }
// object, which is why the read site is `booking.trip_media?.[0]?.count ?? 0`.
//
// The Pick<> below must stay in step with BOOKING_PROFILE_COLUMNS in db.ts. It
// used to be the whole `Profile`, because the query used to be `profiles(*)` —
// which meant the renter's date of birth, home address, and Stripe identity
// session id were serialized into the page on every load, none of them read by
// anything that renders.
export type BookingWithDetails = Booking & {
    cars: Car
    profiles: Pick<
        Profile,
        'id' | 'full_name' | 'email' | 'phone' | 'num_trips' | 'created_at' | 'identity_verified'
    >
    trip_media: { count: number }[]
}

// getTripMedia (db.ts:1479) and recordTripMedia (db.ts:1582):
//     .select('*, profiles:uploaded_by(full_name)')
// This join is aliased — the result key is `profiles` but the FK it follows is
// `uploaded_by`. Already modelled as `TripMediaItem` in src/lib/trip-media.ts,
// which also carries a resolved signed `url` that isn't a column at all, so it
// stays there rather than being restated here.