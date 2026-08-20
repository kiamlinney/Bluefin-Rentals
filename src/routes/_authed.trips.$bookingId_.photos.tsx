import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { ArrowLeft, Camera, ImagePlus } from 'lucide-react'
import { getBookingById, getTripMedia } from '@/lib/db.ts'
import { getUserWithProfile } from '@/lib/auth.ts'
import { TripMediaGrid } from '@/components/trip/TripMediaGrid.tsx'
import { TripMediaLightbox } from '@/components/trip/TripMediaLightbox.tsx'
import { formatBusinessDate } from '@/lib/dates.ts'
import {
    MAX_VIDEO_BYTES,
    formatBytes,
    uploadTripMedia,
    validateFiles,
    type TripMediaItem,
    type UploadTask,
} from '@/lib/trip-media.ts'

// The trailing underscore on $bookingId_ opts this route out of nesting under
// _authed.trips.$bookingId.tsx, so it renders as its own page. The URL is
// unaffected: /trips/{bookingId}/photos.
//
// One page for both roles. Every server function it calls goes through
// assertBookingAccess, which admits the platform admin or the renter on the
// booking and nobody else, so the only thing that varies here is the wording and
// where the back link points.
export const Route = createFileRoute('/_authed/trips/$bookingId_/photos')({
    loader: async ({ params }) => {
        const [booking, media, viewer] = await Promise.all([
            getBookingById({ data: params.bookingId }),
            getTripMedia({ data: params.bookingId }),
            getUserWithProfile(),
        ])
        // _authed has already established there is a session; getUserWithProfile
        // only returns null when there isn't one.
        if (!viewer) throw new Error('Not authenticated')
        return { booking, media: media as TripMediaItem[], viewer }
    },
    component: TripPhotosPage,
})

function TripPhotosPage() {
    const { booking, media, viewer } = Route.useLoaderData()
    const { bookingId } = Route.useParams()

    const car = booking.cars
    const renterName = booking.profiles?.full_name ?? 'Guest'
    const isHost = viewer.is_admin
    const mediaViewer = { id: viewer.id, isAdmin: viewer.is_admin }

    const [items, setItems] = useState<TripMediaItem[]>(media)
    const [uploads, setUploads] = useState<UploadTask[]>([])
    const [rejections, setRejections] = useState<{ name: string; reason: string }[]>([])
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
    const [isDragging, setIsDragging] = useState(false)

    const fileInputRef = useRef<HTMLInputElement>(null)

    const photoCount = items.filter(item => item.kind === 'photo').length
    const videoCount = items.length - photoCount
    const uploading = uploads.some(task => task.status === 'preparing' || task.status === 'uploading')
    const uploadingVideo = uploads.some(
        task => task.kind === 'video' && (task.status === 'preparing' || task.status === 'uploading'),
    )

    const handleFiles = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return

        const { accepted, rejected } = validateFiles([...fileList])
        setRejections(rejected)
        if (accepted.length === 0) return

        await uploadTripMedia(bookingId, accepted, {
            onTaskChange: setUploads,
            // Each file is appended the moment it lands, so a partial failure
            // still keeps everything that made it.
            onUploaded: uploaded => setItems(current => [...current, ...uploaded]),
        })

        // Clear the finished queue, keeping only failures so they stay visible.
        setUploads(current => current.filter(task => task.status === 'error'))
    }

    const openPicker = () => fileInputRef.current?.click()

    const formatTripDate = (value: string) => formatBusinessDate(value)

    return (
        <div
            className="min-h-screen py-16 px-4 md:px-8"
            onDragOver={event => { event.preventDefault(); setIsDragging(true) }}
            onDragLeave={event => { if (event.currentTarget === event.target) setIsDragging(false) }}
            onDrop={event => {
                event.preventDefault()
                setIsDragging(false)
                void handleFiles(event.dataTransfer.files)
            }}
        >
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                className="hidden"
                onChange={event => {
                    void handleFiles(event.target.files)
                    event.target.value = ''
                }}
            />

            <div className="max-w-5xl mx-auto">
                {/* Back to whichever page this viewer came from: the host has a
                    reservation page with earnings and renter details, the guest
                    has their own trip page. */}
                {isHost ? (
                    <Link
                        to="/admin/reservation/$bookingId"
                        params={{ bookingId }}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline"
                    >
                        <ArrowLeft size={16} />
                        {renterName.split(' ')[0]}'s trip
                    </Link>
                ) : (
                    <Link
                        to="/trips/$bookingId"
                        params={{ bookingId }}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline"
                    >
                        <ArrowLeft size={16} />
                        Back to trip
                    </Link>
                )}

                <header className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-gray-300 pb-6">
                    <div>
                        <h1 className="text-4xl text-black tracking-tight font-bold">Trip photos</h1>
                        <p className="mt-2 text-sm text-gray-500">
                            {car.year} {car.make} {car.model} ·{' '}
                            {formatTripDate(booking.start_time)} – {formatTripDate(booking.end_time)}
                        </p>
                    </div>

                    {items.length > 0 && (
                        <p className="text-sm text-gray-500">
                            {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
                            {videoCount > 0 && ` · ${videoCount} ${videoCount === 1 ? 'video' : 'videos'}`}
                        </p>
                    )}
                </header>

                {items.length > 0 && (
                    <div className="sticky top-0 z-10 -mx-4 mb-8 flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white/95 px-4 py-4 backdrop-blur md:-mx-8 md:px-8">
                        <button
                            onClick={openPicker}
                            disabled={uploading}
                            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
                        >
                            <ImagePlus size={16} />
                            Add photos or videos
                        </button>
                        <p className="text-sm text-gray-500">
                            {uploadingVideo
                                ? 'Uploading a video — keep this tab open until it finishes.'
                                : `Videos up to ${formatBytes(MAX_VIDEO_BYTES)}.`}
                        </p>
                    </div>
                )}

                {rejections.length > 0 && (
                    <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
                        <p className="text-sm font-semibold text-red-800">
                            {rejections.length === 1
                                ? 'One file was not uploaded'
                                : `${rejections.length} files were not uploaded`}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                            {rejections.map(rejection => (
                                <li key={rejection.name} className="text-sm text-red-700">
                                    {rejection.name} — {rejection.reason}
                                </li>
                            ))}
                        </ul>
                        <button
                            onClick={() => setRejections([])}
                            className="mt-2 text-sm font-semibold text-emerald-700 hover:underline cursor-pointer"
                        >
                            Dismiss
                        </button>
                    </div>
                )}

                {items.length === 0 && uploads.length === 0 ? (
                    <button
                        onClick={openPicker}
                        className={[
                            'mt-8 flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-20 transition-colors cursor-pointer',
                            isDragging
                                ? 'border-emerald-700 bg-emerald-50'
                                : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100',
                        ].join(' ')}
                    >
                        <Camera size={32} className="text-gray-400" />
                        <span className="text-lg font-bold text-black">No photos yet</span>
                        <span className="max-w-sm text-center text-sm text-gray-500">
                            {isHost
                                ? "Document the vehicle's condition before and after the trip. Drop files here, or choose them from your computer."
                                : 'Photos of the car at pickup and return protect you if there’s a dispute about its condition. Drop files here, or choose them from your device.'}
                        </span>
                        <span className="mt-2 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
                            <ImagePlus size={16} />
                            Add photos or videos
                        </span>
                    </button>
                ) : (
                    <div className={isDragging ? 'rounded-xl outline-2 outline-dashed outline-emerald-700 outline-offset-8' : ''}>
                        <TripMediaGrid
                            items={items}
                            uploads={uploads}
                            onOpen={setLightboxIndex}
                            onRetry={openPicker}
                        />
                    </div>
                )}
            </div>

            {lightboxIndex !== null && items[lightboxIndex] && (
                <TripMediaLightbox
                    items={items}
                    index={lightboxIndex}
                    viewer={mediaViewer}
                    onNavigate={setLightboxIndex}
                    onClose={() => setLightboxIndex(null)}
                    onDeleted={mediaId => {
                        const next = items.filter(item => item.id !== mediaId)
                        setItems(next)
                        // Stay on the neighbouring photo rather than closing, so
                        // deleting a run of bad shots takes one click each.
                        setLightboxIndex(next.length === 0
                            ? null
                            : Math.min(lightboxIndex, next.length - 1))
                    }}
                    onCaptionSaved={(mediaId, caption) => setItems(current =>
                        current.map(item => item.id === mediaId ? { ...item, caption } : item)
                    )}
                />
            )}
        </div>
    )
}