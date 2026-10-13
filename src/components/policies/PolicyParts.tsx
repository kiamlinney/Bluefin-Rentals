import type { ReactNode } from 'react'
import { termsSectionHeading, type TermsSectionId } from '@/lib/policy-sections'

// The building blocks of the legal pages.
//
// While the terms and the privacy policy are drafts, two inline markers show
// what is not settled, on the page itself, where nobody can miss it:
//
//   <OwnerDecision id="OD-…">  a business decision nobody has made yet
//                              (an age, a fee, a rule). Never fill one with a
//                              guess; ask the owners.
//   <LegalReview id="LR-…">    wording a lawyer should check before launch.
//
// Every id is listed, with its context and a suggested answer, in
// ImportantFiles/policy-review.md. tests/policy-review.test.ts fails if a page
// and that document disagree about which ids exist. Resolving one means
// replacing the marker with the decided text and moving its row to "Resolved".

export function PolicySection({ id, children }: { id: TermsSectionId; children: ReactNode }) {
    return (
        <section id={id} className="mb-8 scroll-mt-24">
            <h3 className="text-lg font-bold mb-2">{termsSectionHeading(id)}</h3>
            <div className="space-y-3 text-sm leading-relaxed">{children}</div>
        </section>
    )
}

/** A section of a page that isn't the numbered terms (the privacy policy). */
export function PlainSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
    return (
        <section id={id} className="mb-8 scroll-mt-24">
            <h3 className="text-lg font-bold mb-2">{title}</h3>
            <div className="space-y-3 text-sm leading-relaxed">{children}</div>
        </section>
    )
}

export function DraftBanner({ children }: { children: ReactNode }) {
    return (
        <div className="mb-8 rounded-xl border border-amber-700 bg-amber-100 p-4 text-sm text-ink">
            <p className="font-bold">Draft: not yet in effect</p>
            <div className="mt-1 space-y-2">{children}</div>
            <p className="mt-2">
                <OwnerDecisionChip id="example">Amber</OwnerDecisionChip> marks a decision we haven't made yet.{' '}
                <LegalReviewChip id="example">Violet</LegalReviewChip> marks wording still being checked.
            </p>
        </div>
    )
}

function OwnerDecisionChip({ id, children }: { id: string; children: ReactNode }) {
    return (
        <span
            data-review={id}
            className="rounded bg-amber-200 px-1.5 py-0.5 font-semibold text-amber-950 ring-1 ring-amber-500 [box-decoration-break:clone]"
        >
            {children}
        </span>
    )
}

function LegalReviewChip({ id, children }: { id: string; children: ReactNode }) {
    return (
        <span
            data-review={id}
            className="rounded bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-950 ring-1 ring-violet-400 [box-decoration-break:clone]"
        >
            {children}
        </span>
    )
}

/** An open business decision, e.g. <OwnerDecision id="OD-MIN-AGE">minimum renter age</OwnerDecision>. */
export function OwnerDecision({ id, children }: { id: `OD-${string}`; children: ReactNode }) {
    return <OwnerDecisionChip id={id}>[Owner decision: {children}]</OwnerDecisionChip>
}

/**
 * Wording a lawyer should check. Wraps the drafted text itself, so the page
 * still reads in full. `block` for whole paragraphs or lists.
 */
export function LegalReview({ id, block = false, children }: { id: `LR-${string}`; block?: boolean; children: ReactNode }) {
    if (!block) return <LegalReviewChip id={id}>{children}</LegalReviewChip>
    return (
        <div data-review={id} className="space-y-3 rounded-r-lg border-l-4 border-violet-400 bg-violet-50 py-2 pl-3 pr-2">
            <p className="text-xs font-bold uppercase tracking-wider text-violet-800">Legal review</p>
            {children}
        </div>
    )
}
