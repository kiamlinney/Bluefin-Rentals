import { AlertCircle, Play } from 'lucide-react'
import { formatDuration, type TripMediaItem, type UploadTask } from '@/lib/trip-media.ts'
import { businessDateKey, formatDateKey } from '@/lib/dates.ts'

// Trip media falls naturally into a pickup session and a return session, and
// that split is the thing a host is actually looking for in a damage dispute:
// what the car looked like going out versus coming back. Grouping by capture
// day makes that readable without anyone having to tag anything.
function groupByDay(items: TripMediaItem[]) {
    const groups = new Map<string, TripMediaItem[]>()

    // Bucketed on the business calendar day rather than the viewer's, so the
    // pickup/return split doesn't move depending on where the host opens this.
    for (const item of items) {
        const key = businessDateKey(item.created_at)
        const bucket = groups.get(key)
        if (bucket) bucket.push(item)
        else groups.set(key, [item])
    }

    return [...groups.entries()].map(([key, groupItems]) => ({
        key,
        label: formatDateKey(key, { month: 'short', day: 'numeric', year: 'numeric' }),
        items: groupItems,
    }))
}

type TripMediaGridProps = {
    items: TripMediaItem[]
    uploads: UploadTask[]
    onOpen: (index: number) => void
    onRetry: () => void
}

export function TripMediaGrid({ items, uploads, onOpen, onRetry }: TripMediaGridProps) {
    const groups = groupByDay(items)
    const pending = uploads.filter(task => task.status !== 'done')

    // Index into the flat list, so the lightbox arrows walk the whole trip
    // rather than stopping at a day boundary.
    let flatIndex = 0

    return (
        <div className="space-y-10">
            {pending.length > 0 && (
                <section className="space-y-3">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
                        Uploading · {uploads.filter(t => t.status === 'done').length} of {uploads.length} done
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {pending.map(task => (
                            <UploadTile key={task.key} task={task} onRetry={onRetry} />
                        ))}
                    </div>
                </section>
            )}

            {groups.map(group => (
                <section key={group.key} className="space-y-3">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
                        {group.label}
                        <span className="ml-2 font-medium normal-case tracking-normal text-muted">
                            {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
                        </span>
                    </h2>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {group.items.map(item => {
                            const index = flatIndex++
                            return <MediaTile key={item.id} item={item} onOpen={() => onOpen(index)} />
                        })}
                    </div>
                </section>
            ))}
        </div>
    )
}

function MediaTile({ item, onOpen }: { item: TripMediaItem; onOpen: () => void }) {
    const duration = formatDuration(item.duration_seconds)

    return (
        <button
            onClick={onOpen}
            className="group relative aspect-square w-full overflow-hidden rounded-lg bg-subtle border border-line hover:border-ink-400 focus-visible:outline-2 focus-visible:outline-brand transition-colors cursor-pointer"
        >
            {item.thumbUrl ? (
                <img
                    src={item.thumbUrl}
                    alt={item.caption ?? ''}
                    loading="lazy"
                    className="h-full w-full object-cover"
                />
            ) : (
                <div className="flex h-full w-full items-center justify-center text-ink-400">
                    <Play size={24} />
                </div>
            )}

            {item.kind === 'video' && (
                <>
                    <span className="absolute inset-0 flex items-center justify-center">
                        <span className="rounded-full bg-black/50 p-2.5 text-white">
                            <Play size={18} fill="currentColor" />
                        </span>
                    </span>
                    {duration && (
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
                            {duration}
                        </span>
                    )}
                </>
            )}

            {item.caption && (
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-left text-xs font-medium text-white">
                    {item.caption}
                </span>
            )}
        </button>
    )
}

function UploadTile({ task, onRetry }: { task: UploadTask; onRetry: () => void }) {
    if (task.status === 'error') {
        return (
            <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-center">
                <AlertCircle size={20} className="text-red-700" />
                <p className="line-clamp-2 text-xs font-medium text-red-800">{task.name}</p>
                <p className="line-clamp-2 text-xs text-red-700">{task.error}</p>
                <button
                    onClick={onRetry}
                    className="text-xs font-semibold text-pine-500 hover:underline cursor-pointer"
                >
                    Try again
                </button>
            </div>
        )
    }

    return (
        <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-line bg-subtle">
            {task.previewUrl && (
                <img src={task.previewUrl} alt="" className="h-full w-full object-cover opacity-40" />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
                <span className="h-5 w-5 rounded-full border-2 border-line border-t-brand motion-safe:animate-spin" />
                <p className="line-clamp-2 text-xs text-muted">
                    {task.status === 'preparing' ? 'Preparing' : 'Uploading'}
                </p>
            </div>
        </div>
    )
}