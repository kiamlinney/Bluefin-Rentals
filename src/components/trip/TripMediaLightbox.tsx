import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react'
import { deleteTripMedia, updateTripMediaCaption } from '@/lib/db.ts'
import { formatBytes, type TripMediaItem } from '@/lib/trip-media.ts'
import { formatBusinessDateTime } from '@/lib/dates.ts'

const MAX_FRAME_WIDTH = '56rem'
const MAX_FRAME_HEIGHT = '65vh'

// The frame is given an explicit width rather than being left to shrink-wrap the
// image. Intrinsic sizing of a height-capped <img> inside a shrink-to-fit column
// is one of the corners browsers disagree on — the frame can settle on the
// image's full intrinsic width while the image itself renders height-capped and
// much narrower, which is the black-field problem all over again. Deriving the
// width from the stored dimensions removes the guesswork.
function frameWidth(width: number | null, height: number | null) {
    if (!width || !height) return `min(${MAX_FRAME_WIDTH}, 92vw)`
    const ratio = (width / height).toFixed(4)
    return `min(${MAX_FRAME_WIDTH}, 92vw, calc(${MAX_FRAME_HEIGHT} * ${ratio}))`
}

// Who is looking. Both the guest and the host reach this component through the
// same page now, and they are not allowed to do the same things to each other's
// photos — see assertMediaOwnership in db.ts, which is where the rule is
// actually enforced. This prop only keeps the UI from offering an action that
// the server is going to refuse.
export type MediaViewer = {
    id: string
    isAdmin: boolean
}

type TripMediaLightboxProps = {
    items: TripMediaItem[]
    index: number
    viewer: MediaViewer
    onNavigate: (index: number) => void
    onClose: () => void
    onDeleted: (mediaId: string) => void
    onCaptionSaved: (mediaId: string, caption: string | null) => void
}

export function TripMediaLightbox({
    items, index, viewer, onNavigate, onClose, onDeleted, onCaptionSaved,
}: TripMediaLightboxProps) {
    const item = items[index]

    // Admins act on anything on the booking; everyone else only on what they
    // uploaded. A renter deleting the host's photo of the damage they caused is
    // the case this exists for.
    const canModify = Boolean(item) && (viewer.isAdmin || item!.uploaded_by === viewer.id)

    const [caption, setCaption] = useState(item?.caption ?? '')
    const [savingCaption, setSavingCaption] = useState(false)
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const [deleting, setDeleting] = useState(false)

    const overlayRef = useRef<HTMLDivElement>(null)

    // Reset the per-item state whenever the arrows move to a different photo.
    useEffect(() => {
        setCaption(item?.caption ?? '')
        setConfirmingDelete(false)
    }, [item?.id])

    // Return focus to whatever opened the lightbox so keyboard users land back
    // on the tile they came from.
    useEffect(() => {
        const opener = document.activeElement as HTMLElement | null
        overlayRef.current?.focus()
        return () => opener?.focus?.()
    }, [])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
            if (event.key === 'ArrowLeft' && index > 0) onNavigate(index - 1)
            if (event.key === 'ArrowRight' && index < items.length - 1) onNavigate(index + 1)
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [index, items.length, onNavigate, onClose])

    // The page behind the overlay should not scroll while it is open.
    useEffect(() => {
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { document.body.style.overflow = previous }
    }, [])

    if (!item) return null

    const saveCaption = async () => {
        const next = caption.trim()
        if (next === (item.caption ?? '')) return

        setSavingCaption(true)
        try {
            const result = await updateTripMediaCaption({ data: { mediaId: item.id, caption: next } })
            onCaptionSaved(item.id, result.caption)
        } catch {
            setCaption(item.caption ?? '')
        } finally {
            setSavingCaption(false)
        }
    }

    const handleDelete = async () => {
        setDeleting(true)
        try {
            await deleteTripMedia({ data: item.id })
            onDeleted(item.id)
        } catch {
            setDeleting(false)
            setConfirmingDelete(false)
        }
    }

    const aspectRatio = item.width && item.height ? `${item.width} / ${item.height}` : undefined
    const uploader = item.profiles?.full_name ?? 'BlueFin'
    const takenAt = formatBusinessDateTime(
        item.created_at,
        { month: 'short', day: 'numeric', year: 'numeric' },
        { hour: 'numeric', minute: '2-digit' },
    )

    return (
        <div
            ref={overlayRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={item.caption ?? `${item.kind === 'video' ? 'Video' : 'Photo'} ${index + 1} of ${items.length}`}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 outline-none motion-safe:animate-[fadeIn_120ms_ease-out]"
            onClick={event => { if (event.target === event.currentTarget) onClose() }}
        >
            <button
                onClick={onClose}
                aria-label="Close"
                className="absolute top-4 right-4 z-10 p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
            >
                <X size={24} />
            </button>

            {index > 0 && (
                <button
                    onClick={() => onNavigate(index - 1)}
                    aria-label="Previous"
                    className="absolute left-2 md:left-6 z-10 p-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
                >
                    <ChevronLeft size={28} />
                </button>
            )}

            {index < items.length - 1 && (
                <button
                    onClick={() => onNavigate(index + 1)}
                    aria-label="Next"
                    className="absolute right-2 md:right-6 z-10 p-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
                >
                    <ChevronRight size={28} />
                </button>
            )}

            {/* The frame tracks the media's own shape, so a portrait shot gets a
                snug frame instead of sitting in a wide black field. Whatever
                black is left really is letterboxing inside the file — usually a
                phone screenshot rather than a camera original — and now reads
                that way rather than looking like a layout bug. */}
            <div
                style={{ width: frameWidth(item.width, item.height) }}
                className="flex flex-col max-h-full min-w-[min(100%,20rem)] bg-surface text-ink rounded-xl overflow-hidden"
            >
                <div className="relative bg-black flex items-center justify-center">
                    {item.kind === 'video' ? (
                        <video
                            key={item.id}
                            src={item.url ?? undefined}
                            poster={item.thumbUrl ?? undefined}
                            controls
                            autoPlay
                            // A video has no intrinsic size until metadata loads;
                            // the stored dimensions hold the right shape from the
                            // first frame so the frame doesn't jump.
                            style={aspectRatio ? { aspectRatio } : undefined}
                            className="block w-full max-h-[65vh] object-contain"
                        />
                    ) : (
                        <img
                            src={item.url ?? undefined}
                            alt={item.caption ?? 'Trip photo'}
                            className="block w-full max-h-[65vh] object-contain"
                        />
                    )}
                </div>

                <div className="flex items-start justify-between gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1 space-y-1">
                        {canModify ? (
                            <input
                                value={caption}
                                onChange={event => setCaption(event.target.value)}
                                onBlur={saveCaption}
                                onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                                maxLength={200}
                                placeholder="Add a label"
                                aria-label="Photo label"
                                className="w-full text-lg text-ink bg-transparent border-b border-transparent hover:border-line focus:border-brand focus:outline-none placeholder:text-ink-400 py-0.5"
                            />
                        ) : (
                            // Someone else's photo: their label still shows, it
                            // just isn't an input. An empty one renders nothing
                            // rather than an editable-looking placeholder.
                            item.caption && (
                                <p className="w-full text-lg text-ink py-0.5">{item.caption}</p>
                            )
                        )}
                        <p className="text-sm text-muted">
                            {takenAt} · by {uploader}
                            {savingCaption && <span className="text-ink-400"> · saving</span>}
                            <span className="text-ink-400"> · {formatBytes(item.size_bytes)}</span>
                        </p>
                    </div>

                    {/* Same inline confirm the reservation page uses to cancel a
                        trip — a second modal on top of this one would be worse. */}
                    {!canModify ? null : !confirmingDelete ? (
                        <button
                            onClick={() => setConfirmingDelete(true)}
                            aria-label="Delete"
                            className="shrink-0 p-2 rounded-full text-muted hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                        >
                            <Trash2 size={20} />
                        </button>
                    ) : (
                        <div className="shrink-0 flex items-center gap-3">
                            <span className="text-s text-ink">Delete this?</span>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                className="text-s text-ink bg-red-700/80 px-3 py-1 rounded-md hover:bg-red-500 border border-ink disabled:opacity-50 cursor-pointer"
                            >
                                {deleting ? '...' : 'Yes'}
                            </button>
                            <button
                                onClick={() => setConfirmingDelete(false)}
                                className="text-xs text-ink hover:text-muted cursor-pointer"
                            >
                                Back
                            </button>
                        </div>
                    )}
                </div>

                <div className="px-5 pb-3 text-xs text-ink-400">
                    {index + 1} of {items.length} · Use ← and → to move, Esc to close
                </div>
            </div>
        </div>
    )
}