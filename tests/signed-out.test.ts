// Pages behind sign-in, opened while signed out (an emailed trip or pay link).
// `_authed` shows the sign-in form instead of the page, but the page's loader
// still runs. Until 2026-10-08 every one of these threw without a session and
// the request answered HTTP 500. Each must now return without touching anything.

import { describe, expect, it } from 'vitest'
import { h, signIn } from './harness'
import { world, paidTrip, GUEST } from './fixtures'
import { Route as Trip } from '../src/routes/_authed.trips.$bookingId'
import { Route as TripExtras } from '../src/routes/_authed.trips.$bookingId_.extras'
import { Route as TripPay } from '../src/routes/_authed.trips.$bookingId_.pay.$chargeId'
import { Route as TripPhotos } from '../src/routes/_authed.trips.$bookingId_.photos'
import { Route as TripReceipt } from '../src/routes/_authed.trips.$bookingId_.receipt'
import { Route as Profile } from '../src/routes/_authed.profile'
import { Route as ProfileEdit } from '../src/routes/_authed.profile_.edit'
import { Route as Trips } from '../src/routes/_authed.trips.index'

const pages = { Trip, TripExtras, TripPay, TripPhotos, TripReceipt, Profile, ProfileEdit, Trips }
const load = (route: unknown, isLoggedIn: boolean, bookingId = 'b') =>
    (route as any).options.loader({
        params: { bookingId, chargeId: 'c' },
        context: { isLoggedIn, user: null },
        deps: {},
    })

describe('pages behind sign-in, signed out', () => {
    for (const [name, route] of Object.entries(pages)) {
        it(`${name} loads nothing and doesn't throw`, async () => {
            world('2026-10-10T17:00:00Z')
            signIn(null)
            // Promise.resolve: some loaders are async, some return directly.
            const data = await Promise.resolve(load(route, false))
            if (name !== 'Trips') expect(data).toBeNull()
            expect(h.db.log).toHaveLength(0) // not a single query
        })
    }

    it('still loads the trip once signed in', async () => {
        world('2026-10-10T17:00:00Z')
        const { booking } = paidTrip({ start: '2026-10-20T15:00:00Z', end: '2026-10-23T15:00:00Z', bookedAt: '2026-10-01T15:00:00Z' })
        signIn(GUEST)
        const data = await load(Trip, true, booking.id)
        expect(data.booking.id).toBe(booking.id)
    })
})
