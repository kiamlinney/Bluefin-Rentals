import { createFileRoute, redirect } from '@tanstack/react-router'

// The trips list moved to /trips on 2026-09-29. This keeps old bookmarks and
// links to /my-bookings working.
export const Route = createFileRoute('/my-bookings')({
    beforeLoad: () => {
        throw redirect({ to: '/trips', replace: true })
    },
})
