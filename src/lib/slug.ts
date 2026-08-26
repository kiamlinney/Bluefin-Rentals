// Human-readable car URLs: /fleet/2018-jeep-cherokee-6
//
// The trailing id is what actually resolves the car — everything before it is
// decoration for readers and search engines.
type CarNameParts = { id: number | string; year: number; make: string; model: string }

/** "2017 Honda CR-V" -> "2017-honda-cr-v" */
export function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

export function carSlug(car: CarNameParts): string {
    return `${slugify(`${car.year} ${car.make} ${car.model}`)}-${car.id}`
}

/**
 * Recover the car id from a slug, or null when the segment carries no id at
 * all (the route treats that as a 404 rather than guessing at a car).
 *
 * Bare numeric ids are accepted too, so `/fleet/6` still resolves. That keeps
 * every link that predates slugs alive, and lets call sites that only have an
 * id on hand link without loading the car first — the route redirects them to
 * the canonical slug either way.
 */
export function parseCarIdFromSlug(slug: string): string | null {
    const withTrailingId = /-(\d+)$/.exec(slug)
    if (withTrailingId) return withTrailingId[1] ?? null
    return /^\d+$/.test(slug) ? slug : null
}