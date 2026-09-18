/**
 * Car photo URLs.
 *
 *
 * - Migrated cars live in the `car-gallery` bucket as `.avif` — real listing
 *   photos pulled off Turo, 1242x745, ~124KB each, uploaded with a one-year
 *   `Cache-Control` by `scripts/upload-car-images.ts`.
 * - Everything else still lives in the original `car gallery` bucket (with the
 *   space, which is why the URLs carry `%20`) as `.PNG` — phone screenshots,
 *   1206x2622 portrait, ~1.3MB each, served `no-cache`.
 *
 */

const PROJECT_ID = 'fmueikfpthimanfrituz'

const NEW_BUCKET = 'car-gallery'
const OLD_BUCKET = 'car%20gallery'

/**
 * Cars whose photos have been replaced. Cars 4 (Fusion Hybrid), 5 and 6
 * (Cherokees) have no Turo photos yet and are deliberately absent — they keep
 * serving the old screenshots until someone uploads a folder for them.
 *
 * To migrate one: add its folder to `scripts/upload-car-images.ts`, run it, run
 * the SQL it prints, then add the id here.
 */
const MIGRATED_CAR_IDS = new Set([1, 3, 7, 8, 9, 10, 11])

/**
 * Ids reach these helpers as numbers from the database and as strings from the
 * URL slug, so every entry point normalises rather than making each caller do it.
 */
type CarId = number | string

export const isMigrated = (carId: CarId) => MIGRATED_CAR_IDS.has(Number(carId))

/** File extension a given car's photos are stored under. */
export const carImageExtension = (carId: CarId) => (isMigrated(carId) ? 'avif' : 'PNG')

/**
 * URL for an exact stored filename — use this with values out of
 * `cars.gallery_images`, which already carry the right extension.
 */
export function carImageUrl(carId: CarId, fileName: string): string {
    const bucket = isMigrated(carId) ? NEW_BUCKET : OLD_BUCKET
    return `https://${PROJECT_ID}.supabase.co/storage/v1/object/public/${bucket}/car_${carId}/${fileName}`
}

/**
 * URL for a photo named without its extension (`main`, `top_left`, ...). Use
 * this for the fixed slots the layout hardcodes, so a car that hasn't migrated
 * still resolves to its `.PNG`.
 */
export function carPhotoUrl(carId: CarId, baseName: string): string {
    return carImageUrl(carId, `${baseName}.${carImageExtension(carId)}`)
}

/** Shorthand for the single photo most surfaces show. */
export const carMainImageUrl = (carId: CarId) => carPhotoUrl(carId, 'main')