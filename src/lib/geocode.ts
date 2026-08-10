// Address lookup for delivery pickups, backed by Mapbox.
//
// The only consumer that needs coordinates is the 10-mile delivery radius, so
// this module does exactly one thing: turn what a customer is typing into a
// short list of real addresses, each already measured against the home base.
//
// ── Why this is a server function ────────────────────────────────────────────
// The obvious alternative — call Mapbox straight from the browser with a
// VITE_-prefixed token — would ship the credential in the client bundle, because
// that prefix is precisely what tells Vite to inline a value at build time.
// Anyone could then read it out of the JS and spend the quota. Proxying through
// a server fn keeps MAPBOX_TOKEN in process.env where it belongs, which is the
// same rule the rest of this codebase already follows for the Supabase service
// role key and the Stripe secret (see CLAUDE.md).
//
// ── Why the distance is computed here and not in the component ───────────────
// The picker only ever renders what this returns. Handing the UI raw coordinates
// and letting it decide what's in range would put the service-area rule in the
// one place a customer can edit. The rule lives in src/lib/pickup.ts and is
// applied here and again in createCheckoutSession; the client is told the answer,
// never asked for it.

import { createServerFn } from '@tanstack/react-start'
import {
    DELIVERY_RADIUS_MILES,
    HOME_BASE,
    milesFromHomeBase,
} from './pickup'

export type AddressSuggestion = {
    /** Mapbox's own id for the feature. Used as the React key — see the picker. */
    id: string
    /** Full formatted address, e.g. "2033 Sargent Ave, Saint Paul, Minnesota 55105". */
    label: string
    lat: number
    lng: number
    distanceMiles: number
    withinRadius: boolean
}

// Mapbox returns a lot more than this; only the fields actually read are typed,
// so a change to an unrelated part of their payload can't break the build.
type MapboxFeature = {
    id?: string
    properties?: {
        mapbox_id?: string
        full_address?: string
        place_formatted?: string
        name?: string
        coordinates?: { latitude?: number; longitude?: number }
    }
    geometry?: { coordinates?: [number, number] }
}

// The shortest query worth sending. Below this every request comes back with
// noise anyway, and each keystroke is a billable API call.
const MIN_QUERY_LENGTH = 3

// Five is what fits in the dropdown without it needing to scroll, which keeps
// the whole choice visible inside the booking card.
const RESULT_LIMIT = 5

// The lookup itself, as a plain async function.
//
// Split from the server fn below so the server can call it directly. db.ts
// re-geocodes a delivery address during checkout, and going through the
// createServerFn wrapper from inside another server function would route a
// server-to-server call back out through the RPC layer for no reason. The
// wrapper exists for the browser; this is the implementation both share, which
// keeps the customer's suggestions and the server's verification on identical
// query parameters — a different `types` or `proximity` on one side could return
// a slightly different coordinate and reject an address the picker accepted.
export async function geocodeAddresses(query: string): Promise<AddressSuggestion[]> {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) return []

    const token = process.env.MAPBOX_TOKEN
    if (!token) {
        // Logged rather than thrown: a missing token is a deployment mistake,
        // and the operator needs to see it, but the customer's car page
        // shouldn't die over it. They lose the delivery option and keep
        // every free one.
        console.error('[geocode] MAPBOX_TOKEN is not set — delivery address search disabled')
        return []
    }

    // Geocoding v6 forward, not the Search Box autocomplete API. Search Box
    // gives marginally better mid-word suggestions but requires managing
    // session tokens and carries per-session billing semantics; forward
    // geocoding is a stateless GET, which is all a debounced five-row
    // dropdown actually needs.
    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward')
    url.searchParams.set('q', trimmed)
    // Bias, not a filter. "Sargent Ave" exists in several states, and this
    // ranks the Twin Cities one first — but a bbox would hard-exclude
    // anything outside it, and an out-of-range address needs to come back as
    // a *rejection with a distance* ("that's 43 miles away"), not as "no
    // results found", which reads like the address doesn't exist.
    url.searchParams.set('proximity', `${HOME_BASE.lng},${HOME_BASE.lat}`)
    url.searchParams.set('country', 'us')
    // Street addresses only. A city or region centroid would geocode fine and
    // then quote a $140 delivery to somewhere nobody can actually meet.
    url.searchParams.set('types', 'address')
    url.searchParams.set('limit', String(RESULT_LIMIT))
    url.searchParams.set('access_token', token)

    let payload: { features?: MapboxFeature[] }
    try {
        const response = await fetch(url)
        if (!response.ok) {
            console.error(`[geocode] Mapbox returned ${response.status} for "${trimmed}"`)
            return []
        }
        payload = await response.json()
    } catch (error) {
        // Every failure mode collapses to an empty list on purpose. A
        // geocoder outage should degrade to "you can't book delivery right
        // now" — the picker says so and Continue stays blocked — rather than
        // throwing into an error boundary and taking down a car page that
        // three other pickup options would have worked fine on.
        console.error('[geocode] Mapbox request failed:', error)
        return []
    }

    return (payload.features ?? []).flatMap<AddressSuggestion>(feature => {
        // v6 puts coordinates in properties.coordinates; the GeoJSON geometry
        // is the fallback and is [lng, lat] — that order is a GeoJSON
        // convention and the opposite of how every other API here writes it,
        // so it's read explicitly rather than destructured positionally.
        const lat = feature.properties?.coordinates?.latitude ?? feature.geometry?.coordinates?.[1]
        const lng = feature.properties?.coordinates?.longitude ?? feature.geometry?.coordinates?.[0]
        const label =
            feature.properties?.full_address ??
            [feature.properties?.name, feature.properties?.place_formatted]
                .filter(Boolean)
                .join(', ')

        // A feature with no usable coordinates can't be measured, and an
        // unmeasurable address can't be checked against the radius — so it's
        // dropped rather than shown as a row that would fail on click.
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !label) return []

        const point = { lat: lat as number, lng: lng as number }
        const distanceMiles = milesFromHomeBase(point)

        return [{
            id: feature.properties?.mapbox_id ?? feature.id ?? label,
            label,
            lat: point.lat,
            lng: point.lng,
            distanceMiles,
            withinRadius: distanceMiles <= DELIVERY_RADIUS_MILES,
        }]
    })
}

// The browser-facing wrapper. Everything meaningful is in geocodeAddresses; this
// exists purely so the picker can reach it without the Mapbox token ever leaving
// the server.
export const searchAddresses = createServerFn({ method: 'GET' })
    .inputValidator((query: string) => query)
    .handler(({ data: query }) => geocodeAddresses(query))