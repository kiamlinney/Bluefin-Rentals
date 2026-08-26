import { createFileRoute } from '@tanstack/react-router'
import { absoluteUrl } from '@/lib/site'

// This file is like a sign at the entrance stating which routes are off limits for crawlers to help them navigate

// Everything a signed-in user or an admin sees is disallowed: those pages need
// auth, so a crawler only ever gets a login screen out of them.

const BODY = `User-agent: *
Allow: /

Disallow: /admin
Disallow: /api/
Disallow: /checkout/
Disallow: /profile
Disallow: /my-bookings
Disallow: /trips/
Disallow: /login
Disallow: /403

Sitemap: ${absoluteUrl('/sitemap.xml')}
`

export const Route = createFileRoute('/robots.txt')({
    server: {
        handlers: {
            GET: () =>
                new Response(BODY, {
                    headers: {
                        'content-type': 'text/plain; charset=utf-8',
                        'cache-control': 'public, max-age=3600',
                    },
                }),
        },
    },
})