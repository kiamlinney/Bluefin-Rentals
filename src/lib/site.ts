// The site's absolute origin, used anywhere a full URL is required rather than
// a path: canonical tags, the sitemap, and robots.txt.
//
// VITE_-prefixed on purpose. Canonical tags are rendered once during SSR and
// again when React hydrates; if the two runs disagreed on the origin, React
// would report a hydration mismatch. A server-only variable is invisible to the
// browser bundle, so the value has to be public to stay consistent.
//
// The fallback is the dev server. Set VITE_SITE_URL to the real domain before
// deploying — a canonical tag pointing at localhost tells Google the page's
// official home is a machine it cannot reach.
const RAW_SITE_URL = import.meta.env.VITE_SITE_URL || 'http://localhost:5173'

/** Origin with any trailing slash removed, so `${SITE_URL}/path` is always well-formed. */
export const SITE_URL = RAW_SITE_URL.replace(/\/+$/, '')

export function absoluteUrl(path: string): string {
    return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

// Whether search engines may index the site. Off unless explicitly enabled, so a
// new deploy is never accidentally indexable — the default has to be the safe one.
//
// The site is deliberately kept out of the index until Stripe is live: a car
// rental listing that can't take a payment earns a first impression it can't
// honour, and Google is slow to re-crawl and revise one. Set VITE_ALLOW_INDEXING
// to 'true' in the host's variables once live keys are in.
//
// This is enforced with a `noindex` meta tag (see __root.tsx), NOT with
// `Disallow: /` in robots.txt — those do different jobs and the robots route
// keeps allowing crawls on purpose. Blocking the crawl would mean Google never
// reads the noindex, while still being free to index the bare URL from any
// external link, producing a listing nothing on the site can retract.
//
// VITE_-prefixed for the same reason as the site URL above: the meta tag renders
// during SSR and again at hydration, and a server-only variable is invisible to
// the browser, so the two runs would disagree.
export const ALLOW_INDEXING = import.meta.env.VITE_ALLOW_INDEXING === 'true'