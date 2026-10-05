/**
 * Car photo URLs.
 *
 * Every car's photos live in the `car-gallery` bucket as `.avif` — real Turo
 * listing exports, 5:3 (1242x745), ~40-190KB each — uploaded with a one-year
 * `Cache-Control` by `scripts/upload-car-images.ts`.
 *
 * There used to be a second bucket called `car gallery`, with a space, so every
 * URL carried `%20`; buckets can't be renamed, so replacing it meant a new
 * bucket and a copy. It is gone, along with the phone screenshots it held
 * (1206x2622 portrait, ~1.3MB each) and the retired Cherokee that was the last
 * car still serving them.
 */

const PROJECT_ID = 'fmueikfpthimanfrituz'
const BUCKET = 'car-gallery'
const EXTENSION = 'avif'

/**
 * Ids reach these helpers as numbers from the database and as strings from the
 * URL slug, so every entry point takes both rather than making callers convert.
 */
type CarId = number | string

/**
 * URL for an exact stored filename — use this with values out of
 * `cars.gallery_images`, which already carry the extension.
 */
export function carImageUrl(carId: CarId, fileName: string): string {
    return `https://${PROJECT_ID}.supabase.co/storage/v1/object/public/${BUCKET}/car_${carId}/${fileName}`
}

/**
 * URL for a photo named without its extension (`main`, `top_left`, ...), for
 * the fixed slots the car page layout hardcodes.
 */
export function carPhotoUrl(carId: CarId, baseName: string): string {
    return carImageUrl(carId, `${baseName}.${EXTENSION}`)
}

/** Shorthand for the single photo most surfaces show. */
export const carMainImageUrl = (carId: CarId) => carPhotoUrl(carId, 'main')
