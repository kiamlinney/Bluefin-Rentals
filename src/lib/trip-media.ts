// Browser-side half of the trip media upload. Photos are compressed and
// thumbnailed here rather than on the server or through Supabase's image
// transformation, so a 100-photo trip costs ~45MB of storage instead of ~400MB
// and the grid loads thumbnails instead of full-size files.
//
// Bytes never pass through a server function: db.ts mints signed upload URLs
// and the browser PUTs straight to storage.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createTripMediaUploadUrls, recordTripMedia, TRIP_MEDIA_BUCKET } from './db'

// The project's Free plan caps every upload at 50MB, and a bucket cannot be set
// above the project-wide limit. Raise this to 200MB only together with the
// bucket's file_size_limit (supabase/migrations/20260810230000_trip_media.sql)
// after upgrading to Pro — otherwise the upload fails at the storage API with a
// far less readable error than the one below.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024

// Long edge of the stored image. 2000px still reads a license plate or an
// odometer at full zoom, which is the whole point of these photos.
const MAX_IMAGE_EDGE = 2000
const IMAGE_QUALITY = 0.82

const THUMB_EDGE = 400
const THUMB_QUALITY = 0.7

// Three at a time keeps a 100-photo batch moving without starving the tab of
// memory while canvases are alive.
const UPLOAD_CONCURRENCY = 3

export type TripMediaItem = {
    id: string
    booking_id: string
    kind: 'photo' | 'video'
    storage_path: string
    thumb_path: string | null
    caption: string | null
    mime_type: string
    size_bytes: number
    width: number | null
    height: number | null
    duration_seconds: number | null
    uploaded_by: string | null
    created_at: string
    profiles: { full_name: string | null } | null
    url: string | null
    thumbUrl: string | null
}

export type UploadTask = {
    key: string
    name: string
    kind: 'photo' | 'video'
    status: 'preparing' | 'uploading' | 'done' | 'error'
    error?: string
    previewUrl?: string
}

let browserClient: SupabaseClient | null = null

// Signed upload tokens carry their own authorization, so this client never
// needs a session — it exists only to PUT bytes at a pre-signed path.
function getBrowserClient(): SupabaseClient {
    if (!browserClient) {
        browserClient = createClient(
            import.meta.env.VITE_SUPABASE_URL!,
            import.meta.env.VITE_SUPABASE_ANON_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } }
        )
    }
    return browserClient
}

export function isVideo(file: File) {
    return file.type.startsWith('video/')
}

function extensionOf(file: File, fallback: string) {
    const match = /\.([a-z0-9]+)$/i.exec(file.name)
    return match?.[1]?.toLowerCase() ?? fallback
}

function drawToBlob(
    source: ImageBitmap | HTMLVideoElement,
    sourceWidth: number,
    sourceHeight: number,
    maxEdge: number,
    quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return Promise.reject(new Error('Canvas is unavailable'))
    ctx.drawImage(source, 0, 0, width, height)

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            blob => blob
                ? resolve({ blob, width, height })
                : reject(new Error('Could not encode image')),
            'image/jpeg',
            quality,
        )
    })
}

type PreparedUpload = {
    kind: 'photo' | 'video'
    body: Blob
    ext: string
    mimeType: string
    thumb: Blob | null
    width: number | null
    height: number | null
    durationSeconds: number | null
    previewUrl: string
}

async function preparePhoto(file: File): Promise<PreparedUpload> {
    let bitmap: ImageBitmap
    try {
        // imageOrientation applies the EXIF rotation, which canvas otherwise
        // discards — without it every portrait phone photo lands sideways.
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
        // Chrome and Firefox cannot decode iPhone-original HEIC. Store the
        // original bytes untouched and skip the thumbnail; the grid falls back
        // to the full-size URL for that tile. Photos exported through macOS
        // Photos are already JPEG and never reach this branch.
        return {
            kind: 'photo',
            body: file,
            ext: extensionOf(file, 'jpg'),
            mimeType: file.type || 'image/jpeg',
            thumb: null,
            width: null,
            height: null,
            durationSeconds: null,
            previewUrl: URL.createObjectURL(file),
        }
    }

    try {
        const full = await drawToBlob(bitmap, bitmap.width, bitmap.height, MAX_IMAGE_EDGE, IMAGE_QUALITY)
        const thumb = await drawToBlob(bitmap, bitmap.width, bitmap.height, THUMB_EDGE, THUMB_QUALITY)

        return {
            kind: 'photo',
            body: full.blob,
            ext: 'jpg',
            mimeType: 'image/jpeg',
            thumb: thumb.blob,
            width: full.width,
            height: full.height,
            durationSeconds: null,
            previewUrl: URL.createObjectURL(thumb.blob),
        }
    } finally {
        bitmap.close()
    }
}

async function prepareVideo(file: File): Promise<PreparedUpload> {
    const base: PreparedUpload = {
        kind: 'video',
        body: file,
        ext: extensionOf(file, 'mp4'),
        mimeType: file.type || 'video/mp4',
        thumb: null,
        width: null,
        height: null,
        durationSeconds: null,
        previewUrl: '',
    }

    // Videos upload as-is — no transcoding in the browser. All that happens here
    // is grabbing a poster frame and the duration so the grid has something to
    // show without downloading the video.
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.src = objectUrl

    try {
        const poster = await new Promise<PreparedUpload>((resolve, reject) => {
            const fail = () => reject(new Error('Could not read video'))
            video.onerror = fail

            video.onloadedmetadata = () => {
                // A frame at 0 is often black; a fraction in is usually not.
                video.currentTime = Math.min(0.1, (video.duration || 1) / 2)
            }

            video.onseeked = async () => {
                try {
                    const thumb = await drawToBlob(
                        video, video.videoWidth, video.videoHeight, THUMB_EDGE, THUMB_QUALITY,
                    )
                    resolve({
                        ...base,
                        thumb: thumb.blob,
                        width: video.videoWidth,
                        height: video.videoHeight,
                        durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
                        previewUrl: URL.createObjectURL(thumb.blob),
                    })
                } catch (err) {
                    reject(err)
                }
            }

            setTimeout(fail, 15000)
        })
        return poster
    } catch {
        // Codec the browser cannot decode (some .mov files). Upload it anyway;
        // the tile shows a video placeholder instead of a poster frame.
        return base
    } finally {
        video.src = ''
        URL.revokeObjectURL(objectUrl)
    }
}

async function putSigned(path: string, token: string, body: Blob, contentType: string) {
    const { error } = await getBrowserClient()
        .storage
        .from(TRIP_MEDIA_BUCKET)
        .uploadToSignedUrl(path, token, body, { contentType })

    if (error) throw new Error(error.message)
}

export function validateFiles(files: File[]) {
    const accepted: File[] = []
    const rejected: { name: string; reason: string }[] = []

    for (const file of files) {
        if (isVideo(file)) {
            if (file.size > MAX_VIDEO_BYTES) {
                rejected.push({
                    name: file.name,
                    reason: `Video is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_VIDEO_BYTES)}.`,
                })
                continue
            }
        } else if (!file.type.startsWith('image/')) {
            rejected.push({ name: file.name, reason: 'Only photos and videos can be uploaded.' })
            continue
        }
        accepted.push(file)
    }

    return { accepted, rejected }
}

export function formatBytes(bytes: number) {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function formatDuration(seconds: number | null) {
    if (!seconds || !Number.isFinite(seconds)) return null
    const total = Math.round(seconds)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Compresses, uploads, and records a batch of files, reporting progress as it
 * goes. Each file is recorded as soon as its bytes land, so a failure partway
 * through a 100-photo batch keeps everything already uploaded.
 */
export async function uploadTripMedia(
    bookingId: string,
    files: File[],
    handlers: {
        onTaskChange: (tasks: UploadTask[]) => void
        onUploaded: (items: TripMediaItem[]) => void
    },
) {
    const tasks: UploadTask[] = files.map((file, index) => ({
        key: `${index}-${file.name}-${file.lastModified}`,
        name: file.name,
        kind: isVideo(file) ? 'video' : 'photo',
        status: 'preparing',
    }))

    const publish = () => handlers.onTaskChange([...tasks])
    publish()

    let cursor = 0

    const runOne = async (task: UploadTask, file: File) => {
        try {
            const prepared = isVideo(file) ? await prepareVideo(file) : await preparePhoto(file)

            task.previewUrl = prepared.previewUrl
            task.status = 'uploading'
            publish()

            const [signed] = await createTripMediaUploadUrls({
                data: {
                    bookingId,
                    files: [{ ext: prepared.ext, withThumb: prepared.thumb !== null }],
                },
            })
            if (!signed) throw new Error('Could not start the upload')

            await putSigned(signed.path, signed.token, prepared.body, prepared.mimeType)
            if (prepared.thumb && signed.thumbPath && signed.thumbToken) {
                await putSigned(signed.thumbPath, signed.thumbToken, prepared.thumb, 'image/jpeg')
            }

            const recorded = await recordTripMedia({
                data: {
                    bookingId,
                    items: [{
                        id: signed.id,
                        kind: prepared.kind,
                        storagePath: signed.path,
                        thumbPath: prepared.thumb ? signed.thumbPath : null,
                        mimeType: prepared.mimeType,
                        sizeBytes: prepared.body.size,
                        width: prepared.width,
                        height: prepared.height,
                        durationSeconds: prepared.durationSeconds,
                    }],
                },
            })

            task.status = 'done'
            publish()
            handlers.onUploaded(recorded as TripMediaItem[])
        } catch (err: any) {
            task.status = 'error'
            task.error = err?.message ?? 'Upload failed'
            publish()
        }
    }

    const worker = async () => {
        while (cursor < files.length) {
            const index = cursor++
            const task = tasks[index]
            const file = files[index]
            if (task && file) await runOne(task, file)
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker)
    )

    return tasks
}