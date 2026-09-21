import { createFileRoute } from '@tanstack/react-router'
import { absoluteUrl, ALLOW_INDEXING } from '@/lib/site'

// This file is like a sign at the entrance stating which routes are off limits for crawlers to help them navigate

// Everything a signed-in user or an admin sees is disallowed: those pages need
// auth, so a crawler only ever gets a login screen out of them.

// Crawling stays allowed even while the site is held out of the index. That is
// deliberate: the `noindex` meta tag in __root.tsx is what keeps pages out of
// search results, and a crawler has to be able to fetch a page to read it. A
// blanket `Disallow: /` here would block the crawl, leaving Google free to index
// the bare URL from any external link while never seeing the directive that says
// not to. Only the sitemap is withheld, since there's nothing to advertise yet.
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
${ALLOW_INDEXING ? `
Sitemap: ${absoluteUrl('/sitemap.xml')}
` : ''}`

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