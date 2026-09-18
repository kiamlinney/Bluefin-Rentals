/**
 * Uploads the Turo listing photos into the `car-gallery` bucket.
 *
 *   node --experimental-strip-types --env-file=.env scripts/upload-car-images.ts [--dry-run]
 *
 * Why this exists rather than dragging the folders into the Supabase dashboard:
 * the dashboard uploader sets its own `Cache-Control` and gives you no way to
 * change it. The old bucket is served `no-cache`, so every car photo costs a
 * revalidation round trip on every page view — five of them before a car page
 * paints, ~17 when the lightbox opens. `cacheControl` below is the whole point
 * of doing this from a script; the AVIFs themselves are uploaded untouched.
 *
 * The files are NOT re-encoded. They arrive from Turo at 1242x745 and ~124KB,
 * which is already the right size for every slot that renders them, so there is
 * no resize or transcode step and there shouldn't be one.
 *
 * Safe to re-run: uploads are `upsert`, so a partial run just resumes.
 */

import { createClient } from '@supabase/supabase-js'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BUCKET = 'car-gallery'
const SOURCE_DIR = 'ClaudeFiles/car_images'
const CACHE_CONTROL = '31536000' // 1 year, in seconds

/**
 * Local folder -> `cars.id`. Cherokee (5) and Fusion Hybrid (4) are absent on
 * purpose: no Turo photos for them yet, so they keep serving the old PNGs out
 * of the `car gallery` bucket. Car 6 is the retired Cherokee.
 *
 * Adding a car here means also adding its id to MIGRATED_CAR_IDS in
 * src/lib/car-images.ts, or the site will keep pointing at the old bucket.
 */
const FOLDER_TO_CAR_ID: Record<string, number> = {
    Civic: 1,
    Fusion: 3,
    Camry: 7,
    Prius: 8,
    CRV: 9,
    Outback: 10,
    Corolla: 11,
}

/** The five slots the car page layout hardcodes; every car needs all of them. */
const REQUIRED = ['main', 'top_left', 'top_right', 'bottom_left', 'bottom_right']

const dryRun = process.argv.includes('--dry-run')

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env')
    process.exit(1)
}

const supabase = createClient(url, serviceKey)

/**
 * The four corners were renamed out of the middle of the numbered run, so each
 * car's numbering has exactly four holes in it — and those holes are where the
 * corners belong. Fill them in this order and the gallery reads in the order the
 * photos were shot.
 */
const CORNERS = ['bottom_left', 'top_right', 'top_left', 'bottom_right']

/**
 * Fusion's numbering is off by one against every other car: `bottom_left` sits
 * ahead of `1` rather than in a hole, and the hole at 6 goes unused. Derived
 * ordering can't express that, so it's written out.
 */
const MANUAL_ORDER: Record<string, string[]> = {
    Fusion: ['main', 'bottom_left', '1', '2', '3', '4', 'top_right', '7', '8', '9',
             'top_left', '11', '12', 'bottom_right', '14'],
}

/**
 * Produces `cars.gallery_images` — `main` first, then positions 1..n with each
 * corner dropped into its hole. This is the order the lightbox renders in.
 *
 * Throws rather than guessing: a car that doesn't have exactly four holes, or
 * whose ordering would drop or duplicate a file, means the naming convention
 * broke and a silently scrambled gallery is worse than a failed run.
 */
function orderFiles(folder: string, files: string[]): string[] {
    const bare = files.map((f) => f.replace(/\.avif$/i, ''))
    const order = MANUAL_ORDER[folder] ?? deriveOrder(folder, bare)

    const got = [...order].sort().join()
    const want = [...bare].sort().join()
    if (got !== want) {
        throw new Error(`${folder}: ordering drops or duplicates files\n  got:  ${got}\n  want: ${want}`)
    }

    return order.map((n) => `${n}.avif`)
}

function deriveOrder(folder: string, bare: string[]): string[] {
    const nums = bare.map((b) => parseInt(b, 10)).filter((n) => !Number.isNaN(n))
    const highest = nums.length + CORNERS.length

    const holes: number[] = []
    for (let i = 1; i <= highest; i++) if (!nums.includes(i)) holes.push(i)
    if (holes.length !== CORNERS.length) {
        throw new Error(
            `${folder}: expected ${CORNERS.length} gaps in 1..${highest}, found ${holes.length} (${holes.join(', ')}) — ` +
            `add an entry to MANUAL_ORDER if this car is numbered differently`,
        )
    }

    const filled = new Map(holes.map((hole, i) => [hole, CORNERS[i]]))
    const order = ['main']
    for (let i = 1; i <= highest; i++) order.push(filled.get(i) ?? String(i))
    return order
}

const sqlLines: string[] = []
let uploaded = 0
let failed = 0

for (const [folder, carId] of Object.entries(FOLDER_TO_CAR_ID)) {
    const dir = join(SOURCE_DIR, folder)

    let entries: string[]
    try {
        entries = readdirSync(dir)
    } catch {
        console.error(`✗ ${folder}: no such folder at ${dir}`)
        failed++
        continue
    }

    const found = entries.filter((f) => f.toLowerCase().endsWith('.avif'))

    // Checked before ordering: a missing corner would otherwise surface as an
    // unexplained extra gap. The hero grid asks for these by name, so a gap here
    // is a broken image on the live car page rather than something that degrades
    // quietly.
    const missing = REQUIRED.filter((r) => !found.includes(`${r}.avif`))
    if (missing.length) {
        console.error(`✗ ${folder} (car_${carId}): missing ${missing.join(', ')} — skipped`)
        failed++
        continue
    }

    let files: string[]
    try {
        files = orderFiles(folder, found)
    } catch (err) {
        console.error(`✗ ${(err as Error).message}`)
        failed++
        continue
    }

    console.log(`\n${folder} → car_${carId} (${files.length} images)`)

    for (const file of files) {
        const localPath = join(dir, file)
        const remotePath = `car_${carId}/${file}`
        const sizeKb = Math.round(statSync(localPath).size / 1024)

        if (dryRun) {
            console.log(`  · ${remotePath.padEnd(28)} ${sizeKb}KB (dry run)`)
            uploaded++
            continue
        }

        const { error } = await supabase.storage.from(BUCKET).upload(remotePath, readFileSync(localPath), {
            cacheControl: CACHE_CONTROL,
            contentType: 'image/avif',
            upsert: true,
        })

        if (error) {
            console.error(`  ✗ ${remotePath}: ${error.message}`)
            failed++
        } else {
            console.log(`  ✓ ${remotePath.padEnd(28)} ${sizeKb}KB`)
            uploaded++
        }
    }

    const publicUrl = `https://${new URL(url).hostname.split('.')[0]}.supabase.co/storage/v1/object/public/${BUCKET}/car_${carId}/main.avif`
    const arrayLiteral = files.map((f) => `'${f}'`).join(', ')
    sqlLines.push(
        `update cars set image_url = '${publicUrl}', gallery_images = array[${arrayLiteral}] where id = ${carId};`,
    )
}

console.log(`\n${'─'.repeat(72)}`)
console.log(`${dryRun ? 'Would upload' : 'Uploaded'}: ${uploaded}    Failed/skipped: ${failed}`)

if (sqlLines.length) {
    console.log(`\nRun this against the linked project to repoint the rows:\n`)
    console.log(sqlLines.join('\n'))
    console.log()
}

process.exit(failed > 0 ? 1 : 0)