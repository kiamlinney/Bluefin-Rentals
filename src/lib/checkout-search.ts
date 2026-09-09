import { z } from 'zod'
import { businessDateKey, businessWallClockTime } from './dates'
import type { BookingRate } from './booking-rate.ts'

// Zod validates that the URL search params are exactly the right shape
// before the loader or component even runs. If a param is missing or
// the wrong type, TanStack Router throws a structured error immediately.
//
// This lives outside the route file so the checkout step components can import
// CheckoutSearch without importing the route itself, which would be circular.
export const checkoutSearchSchema = z.object({
    startDate: z.string(),
    endDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    totalDays: z.number(),
    subtotal: z.number(),
    pickupLocation: z.string(),
    // The pickup choice arrives twice: once as the display string above, and
    // once structurally below.
    //
    // pickupLocation is what the trip summary on this page prints. It is not
    // what anything is priced from — like subtotal, it's a hint that travels
    // through an editable URL. The fields below carry the selection in the shape
    // src/lib/pickup.ts can re-resolve, and createCheckoutSession recomputes the
    // fee (and re-checks the delivery radius) from those rather than from any
    // string the browser handed it.
    //
    // .catch('home') rather than a bare default: a hand-mangled or truncated
    // link should fall back to the free home-base pickup, which is the one option
    // that can never be wrong to offer. Every other value would either overcharge
    // or promise a delivery nobody agreed to.
    //
    // No coordinates here on purpose. The picker resolves them and uses them to
    // show a live distance, but they stay in React state: the server geocodes the
    // address text itself rather than trusting numbers from a URL, so putting
    // them here would be dead weight the customer could edit.
    pickupKind: z.enum(['home', 'listed', 'delivery']).catch('home'),
    pickupId: z.string().optional().catch(undefined),
    pickupAddress: z.string().optional().catch(undefined),
    // Chosen on the checkout page itself, not the car page, but it lives in the
    // URL anyway so the selection survives a refresh mid-checkout and so
    // buildCheckoutSearch below can restore it when resuming a pending booking.
    //
    // Same .catch reasoning as pickupKind: a mangled link falls back to the
    // anchor rate, the one option that can never overcharge. Editing this param
    // by hand changes the price, but only to a price the radio button offers
    // anyway — and the server re-derives the charge from it either way.
    bookingRate: z.enum(['non-refundable', 'refundable']).catch('non-refundable'),
    // bookingId is optional — only present when resuming an existing
    // pending booking rather than creating a fresh one
    bookingId: z.string().optional(),
})

// Derive the search type from the schema so it's always in sync
export type CheckoutSearch = z.infer<typeof checkoutSearchSchema>

/**
 * Rebuilds the search params the car page would have produced, so a pending
 * booking can be resumed at checkout. Called from the my-bookings card and from
 * the trip page's `unpaid` state.
 *
 * This has to reverse wallClockToUtcIso rather than slice the stored timestamp.
 * `start_time.split('T')[0]` takes the UTC day and `start.getHours()` takes the
 * browser's clock, and neither is the day or the hour on the reservation: a 10pm
 * Central return is 03:00Z the next day, so the split hands checkout an endDate
 * one day late. That was survivable only because createCheckoutSession
 * short-circuits on bookingId and returns the stored booking untouched — but if
 * the pending row has since been swept, it falls through and books the wrong
 * range for real.
 *
 * Known gap: pickupKind/pickupId/pickupAddress are not reconstructed, because
 * the booking row stores only the rendered `pickup_location` string. A resumed
 * delivery booking therefore falls back to home-base pickup via the
 * `.catch('home')` above. Fixing it needs the structured selection persisted on
 * the row; it is not something this function can recover.
 *
 * `booking_rate` has no such gap — it is persisted, so a resumed booking
 * comes back on the rate it was priced at rather than snapping to the default.
 */
export function buildCheckoutSearch(booking: {
    id: string
    start_time: string
    end_time: string
    total_price: number
    pickup_location: string
    booking_rate: BookingRate
}): CheckoutSearch {
    const start = new Date(booking.start_time)
    const end = new Date(booking.end_time)

    return {
        startDate: businessDateKey(start),
        endDate: businessDateKey(end),
        startTime: businessWallClockTime(start),
        endTime: businessWallClockTime(end),
        totalDays: Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
        subtotal: booking.total_price,
        pickupLocation: booking.pickup_location,
        pickupKind: 'home',
        pickupId: undefined,
        pickupAddress: undefined,
        bookingRate: booking.booking_rate,
        bookingId: booking.id,
    }
}

// The three sequential checkout steps
export type Step = 'driver-info' | 'identity' | 'payment'