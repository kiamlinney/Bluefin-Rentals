import { z } from 'zod'

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
    // bookingId is optional — only present when resuming an existing
    // pending booking rather than creating a fresh one
    bookingId: z.string().optional(),
})

// Derive the search type from the schema so it's always in sync
export type CheckoutSearch = z.infer<typeof checkoutSearchSchema>

// The three sequential checkout steps
export type Step = 'driver-info' | 'identity' | 'payment'