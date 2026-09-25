import type { ReactNode } from 'react'

// The labelled block both reservation pages are built out of — a small
// uppercase heading, an optional action on the right, and a body.
//
// It was repeated about ten times on the admin page and five on the guest page,
// each with its own slightly different heading classes. Semantic tokens only,
// so it re-themes inside .admin-shell.

export function TripSection({
    title,
    action,
    children,
}: {
    title: string
    /** Usually a link — "View", "Add photos", "Get directions". */
    action?: ReactNode
    children: ReactNode
}) {
    return (
        <section className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink">{title}</h3>
                {action}
            </div>
            {children}
        </section>
    )
}

/** The plain-text body most sections have, so callers don't restate the classes. */
export function TripSectionText({
    children,
    muted = false,
}: {
    children: ReactNode
    muted?: boolean
}) {
    return <p className={muted ? 'text-sm text-muted' : 'text-ink'}>{children}</p>
}
