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