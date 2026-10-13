import { Ban } from 'lucide-react'
import { cn } from '@/lib/utils'

// A customer's tags and, when blocked, a red chip. Shown wherever an owner
// meets a guest: the customer list, the customer page, the reservation page
// and the trip cards, so a blocked guest's upcoming trip doesn't go unnoticed.

export function BlockedChip({ className }: { className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1 rounded bg-red-700 px-2 py-0.5 text-xs font-bold text-white', className)}>
            <Ban size={12} aria-hidden /> Blocked
        </span>
    )
}

export function TagChip({ tag, className }: { tag: string; className?: string }) {
    return (
        <span className={cn('inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700', className)}>
            {tag}
        </span>
    )
}

export function CustomerFlags({
    tags,
    blocked,
    className,
}: {
    tags: string[]
    blocked: boolean
    className?: string
}) {
    if (!blocked && tags.length === 0) return null
    return (
        <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
            {blocked && <BlockedChip />}
            {tags.map(t => <TagChip key={t} tag={t} />)}
        </div>
    )
}
