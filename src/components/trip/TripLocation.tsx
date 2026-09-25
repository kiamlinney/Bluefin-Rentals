import { CarFront, MapPin, Plane } from 'lucide-react'
import { PICKUP_LOCATIONS } from '@/lib/pickup.ts'

// Where a trip is picked up, rendered the same way for the guest and the host.
//
// This replaces three separate implementations — one on the guest trip page,
// one inline on the admin reservation page, one in TripReceipt — which had all
// drifted slightly and each carried its own copy of the airport check.
//
// Written with semantic tokens, so it re-themes to the admin greys inside
// .admin-shell without a variant prop.

/**
 * Whether a stored pickup_location is the airport.
 *
 * A lookup against PICKUP_LOCATIONS rather than a comparison against the frozen
 * 'MSP - Minneapolis, MN' literal, which pickup.ts warns about at length: three
 * files hard-coded that string, so changing the constant would have silently
 * downgraded every future airport reservation to the generic car icon with no
 * error to point at the cause. Now the constant is free to change.
 */
export function isAirportPickup(pickupLocation: string): boolean {
    return PICKUP_LOCATIONS.some(
        location => location.kind === 'airport' && location.bookingLabel === pickupLocation,
    )
}

/** The friendlier name for a listed location, or the stored string as-is. */
export function pickupDisplayName(pickupLocation: string): string {
    return (
        PICKUP_LOCATIONS.find(location => location.bookingLabel === pickupLocation)?.name
        ?? pickupLocation
    )
}

export function TripLocation({
    pickupLocation,
    struck = false,
}: {
    pickupLocation: string
    /** Cancelled trips strike the location through, as Turo's do. */
    struck?: boolean
}) {
    const isAirport = isAirportPickup(pickupLocation)

    return (
        <div className="flex items-center gap-3">
            <div className="p-2 border border-line rounded-full bg-subtle text-muted shrink-0">
                {isAirport ? <Plane size={20} /> : <CarFront size={20} />}
            </div>
            <p className={struck ? 'text-muted line-through' : 'text-ink'}>
                {pickupDisplayName(pickupLocation)}
            </p>
        </div>
    )
}

/**
 * Opens the pickup address in whatever maps app the device prefers.
 *
 * A plain search URL rather than directions from a fixed origin: the guest
 * could be anywhere, and Google resolves "from here" itself.
 */
export function GetDirectionsLink({ pickupLocation }: { pickupLocation: string }) {
    const query = encodeURIComponent(pickupDisplayName(pickupLocation))

    return (
        <a
            href={`https://www.google.com/maps/search/?api=1&query=${query}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-pine-500 hover:underline"
        >
            <MapPin size={14} />
            Get directions
        </a>
    )
}
