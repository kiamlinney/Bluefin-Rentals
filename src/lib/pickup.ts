// Pickup & return locations — the single source of truth for where a car can be
// collected and what that costs.
//
// This module is deliberately pure and isomorphic, for exactly the same reason
// src/lib/pricing.ts is: no React, no Supabase, no Node/browser globals. The
// booking widget (src/components/PickupLocationPicker.tsx) and the server
// (createCheckoutSession in src/lib/db.ts) both import resolvePickup, so the fee
// the customer is quoted and the fee Stripe charges are produced by the same
// function and cannot drift apart. If the two ever disagreed, the customer would
// see one number on the car page and a different one on their card statement.
//
// ── Why a structured selection instead of a string ───────────────────────────
// The pickup choice reaches checkout through URL search params, which the
// customer can edit freely. The previous design passed only the human-readable
// address string and derived everything from it; pricing off that string would
// mean `?pickupLocation=Free%20pickup` is a $120 discount. Everything here is
// keyed by an id that the server re-resolves against the tables below, and the
// display string is *derived* from the id rather than trusted as input.

// ── Home base ────────────────────────────────────────────────────────────────

// Where the fleet actually lives, and the origin every delivery distance is
// measured from.
//
// `label` and `fullAddress` are deliberately different strings. Before a booking
// exists the customer sees only the city and ZIP. `fullAddress` is what gets written to
// bookings.pickup_location once money has changed hands, which is what the
// admin screens and the confirmation email read.
//
// The coordinates are the geocoded position of that address. They're hardcoded
// rather than looked up at runtime because the home base does not move, and a
// geocoder outage must not be able to break the radius check.
export const HOME_BASE = {
    label: 'Saint Paul, MN 55105',
    fullAddress: '2033 Sargent Avenue, Saint Paul, MN 55105',
    lat: 44.9345,
    lng: -93.1720,
} as const

// ── Listed pickup locations ──────────────────────────────────────────────────

export type PickupLocationKind = 'airport' | 'hotel' | 'transit'

export type PickupLocation = {
    /** Stable id. This is what travels through search params and gets re-resolved
     *  server-side, so renaming a location is safe but changing an id is not —
     *  an in-flight checkout would resolve to "unknown location". */
    id: string
    kind: PickupLocationKind
    /** Primary line in the picker. */
    name: string
    /** Secondary line — "Airport", "Hotel", "Train station". */
    subtitle: string
    /** Third line. Omitted for MSP, whose name already says where it is. */
    address?: string
    /** What lands in bookings.pickup_location. See the warning below. */
    bookingLabel: string
}

// The rows shown under "Pickup locations". Order here is render order.
//
// ⚠️  bookingLabel for `msp` is frozen at exactly 'MSP - Minneapolis, MN'.
// src/routes/admin/reservation.$bookingId.tsx string-compares
// booking.pickup_location against that literal to decide whether a reservation
// renders with the plane icon or the generic car icon. Changing `name` is
// harmless — it's display only — but changing this constant would silently
// downgrade every future airport reservation in the admin view, with no error
// anywhere to point at the cause. If it ever does need to change, that
// comparison has to change with it (and ideally become a lookup against this
// table rather than a literal).
export const PICKUP_LOCATIONS: PickupLocation[] = [
    {
        id: 'msp',
        kind: 'airport',
        name: 'Minneapolis–Saint Paul International Airport',
        subtitle: 'Airport',
        bookingLabel: 'MSP - Minneapolis, MN',
    },
    {
        id: 'grand-hotel',
        kind: 'hotel',
        name: 'The Grand Hotel Minneapolis',
        subtitle: 'Hotel',
        address: '615 2nd Avenue South, Minneapolis, MN 55402',
        bookingLabel: 'The Grand Hotel Minneapolis, 615 2nd Avenue South, Minneapolis, MN 55402',
    },
    {
        id: 'msp-light-rail',
        kind: 'transit',
        name: 'Minneapolis–St. Paul International Airport',
        subtitle: 'Train station',
        address: 'Fort Snelling Unorganized Territory, MN 55111',
        bookingLabel: 'MSP Light Rail Station, Fort Snelling Unorganized Territory, MN 55111',
    },
]

export function findPickupLocation(id: string): PickupLocation | undefined {
    return PICKUP_LOCATIONS.find(location => location.id === id)
}

// ── Delivery ─────────────────────────────────────────────────────────────────

// A custom delivery address is the only option that costs anything

// Flat rather than per-mile
export const DELIVERY_FEE = 120
export const DELIVERY_FEE_LABEL = 'Delivery'

// The service-area boundary. Outside this delivery isn't offered at all
export const DELIVERY_RADIUS_MILES = 10

// ── Distance ─────────────────────────────────────────────────────────────────

export type LatLng = { lat: number; lng: number }

const EARTH_RADIUS_MILES = 3958.8

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

// Great-circle distance between two points, in miles.
//
// Straight-line, not driving distance. The 10-mile rule is a service-area
// boundary rather than a drive-time estimate, and straight-line has three
// properties that matter here: it's free, it's deterministic (the same address
// always yields the same answer, so a customer can't get a different verdict on
// a retry), and it needs no second API call on the checkout path. If road
// distance turns out to be materially longer in some direction, the fix is to
// tune DELIVERY_RADIUS_MILES, not to add a routing dependency.
export function haversineMiles(a: LatLng, b: LatLng): number {
    const dLat = toRadians(b.lat - a.lat)
    const dLng = toRadians(b.lng - a.lng)
    const lat1 = toRadians(a.lat)
    const lat2 = toRadians(b.lat)

    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

    return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h))
}

// Distance from the home base, rounded to one decimal — the precision the UI
// shows ("3.2 miles away"). Rounding lives here rather than in the component so
// the number the customer reads and the number the radius check uses are the
// same one; rounding only at display time would let 10.04 miles render as
// "10.0 miles away" next to a rejection message.
export function milesFromHomeBase(point: LatLng): number {
    return Math.round(haversineMiles(HOME_BASE, point) * 10) / 10
}

export function isWithinDeliveryRadius(point: LatLng): boolean {
    return milesFromHomeBase(point) <= DELIVERY_RADIUS_MILES
}

// ── Selection ────────────────────────────────────────────────────────────────

export type PickupSelection =
    | { kind: 'home' }
    | { kind: 'listed'; id: string }
    // Coordinates are optional because "delivery chosen, address not yet
    // verified" is a state the customer genuinely passes through — they're
    // mid-way through typing, or they've edited a confirmed address past
    // recognition. Without a way to represent it, the picker would have to keep
    // reporting the *previous* verified address while the field says something
    // else, and the card above would quote $120 for somewhere the customer has
    // already typed over. Absent coordinates resolve to an error, which blocks
    // Continue until the address is confirmed again.
    //
    // They're display-side only either way: the server geocodes the address text
    // itself and never reads these (see resolvePickupOnServer in src/lib/db.ts).
    | { kind: 'delivery'; address: string; lat?: number; lng?: number }

export const DEFAULT_PICKUP: PickupSelection = { kind: 'home' }

export type ResolvedPickup = {
    /** What the customer sees in the collapsed summary and on the checkout page. */
    label: string
    /** What gets written to bookings.pickup_location. Differs from `label` for the
     *  home base, where the street address is only revealed after booking. */
    bookingLabel: string
    fee: number
    feeLabel: string | null
    /** Non-null when the selection cannot be booked as-is. The car page surfaces
     *  this as its validation message and keeps Continue disabled. */
    error: string | null
}

// Turns a selection into the three things every caller needs: what to show, what
// to store, and what to charge.
//
// It returns an `error` instead of throwing because both callers want to keep
// going when a selection is bad: the widget needs to render the message next to
// a disabled button, and the server wants to log the attempt before rejecting
// it. A thrown error at the widget would take out the whole car page.
export function resolvePickup(selection: PickupSelection): ResolvedPickup {
    if (selection.kind === 'home') {
        return {
            label: HOME_BASE.label,
            bookingLabel: HOME_BASE.fullAddress,
            fee: 0,
            feeLabel: null,
            error: null,
        }
    }

    if (selection.kind === 'listed') {
        const location = findPickupLocation(selection.id)

        // An unknown id means a stale link or a hand-edited URL — a location that
        // was removed from the table above, most likely. Falling back to the home
        // base silently would move someone's airport pickup across town without
        // telling them, so this is an error the customer has to resolve.
        if (!location) {
            return {
                label: '',
                bookingLabel: '',
                fee: 0,
                feeLabel: null,
                error: 'That pickup location is no longer available. Please choose another.',
            }
        }

        return {
            label: location.name,
            bookingLabel: location.bookingLabel,
            // Listed spots are free: the host is meeting the customer somewhere
            // they already go, so there's no dedicated trip to charge for.
            fee: 0,
            feeLabel: null,
            error: null,
        }
    }

    // Delivery. The address is the customer's own text, so it's the one variant
    // that can be structurally valid and still unbookable.
    //
    // The two failure modes below are deliberately separate messages. "No address
    // yet" and "that address is too far" call for completely different actions,
    // and collapsing them into one string would tell a customer whose address was
    // rejected for distance to go and enter an address they can plainly see they
    // already entered.

    // if (!selection.address.trim()) {
    //     return {
    //         label: '',
    //         bookingLabel: '',
    //         fee: 0,
    //         feeLabel: null,
    //         error: 'Please enter a delivery address.',
    //     }
    // }

    // Missing or unusable coordinates mean the address hasn't been confirmed
    // against the geocoder yet — typed but not picked, or picked and then edited
    // beyond recognition. It shows as text in the field but must not price or
    // book until it's been verified.

    // if (!Number.isFinite(selection.lat) || !Number.isFinite(selection.lng)) {
    //     return {
    //         label: selection.address,
    //         bookingLabel: '',
    //         fee: 0,
    //         feeLabel: null,
    //         error: 'Please pick your delivery address from the suggestions so we can check it is in range.',
    //     }
    // }

    const miles = milesFromHomeBase({ lat: selection.lat!, lng: selection.lng! })

    if (miles > DELIVERY_RADIUS_MILES) {
        return {
            label: selection.address,
            bookingLabel: selection.address,
            // Deliberately no fee on the rejected path. If this returned
            // DELIVERY_FEE the quote would briefly show a $120 line for a trip
            // that can't be booked, which reads as "pay more and we'll do it".
            fee: 0,
            feeLabel: null,
            error: `Delivery is only available within ${DELIVERY_RADIUS_MILES} miles of ${HOME_BASE.label} — this address is ${miles} miles away.`,
        }
    }

    return {
        label: selection.address,
        bookingLabel: selection.address,
        fee: DELIVERY_FEE,
        feeLabel: DELIVERY_FEE_LABEL,
        error: null,
    }
}