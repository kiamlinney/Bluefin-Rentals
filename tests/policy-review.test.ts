// The draft terms and privacy policy mark every open point on the page
// (<OwnerDecision id="OD-…">, <LegalReview id="LR-…">), and
// ImportantFiles/policy-review.md lists each one with its context. This keeps
// the two in step: a marker added to a page without a row, or a row left open
// after its marker was resolved, fails here.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TERMS_SECTIONS, termsSection } from '../src/lib/policy-sections'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const PAGES = ['src/routes/policies/terms.tsx', 'src/routes/policies/privacy.tsx']

function markersOnPages(): string[] {
    const ids = PAGES.flatMap(p => [...read(p).matchAll(/<(?:OwnerDecision|LegalReview)\b[^>]*\bid="((?:OD|LR)-[A-Z0-9-]+)"/g)].map(m => m[1]!))
    return ids
}

function openIdsInDoc(): string[] {
    const doc = read('ImportantFiles/policy-review.md')
    const open = doc.split(/^## Resolved/m)[0]!
    return [...open.matchAll(/^\| `((?:OD|LR)-[A-Z0-9-]+)` \|/gm)].map(m => m[1]!)
}

describe('policy review markers', () => {
    it('every marker on the pages is listed once in policy-review.md, and nothing else is open there', () => {
        const onPages = markersOnPages()
        const inDoc = openIdsInDoc()
        expect(onPages.length).toBeGreaterThan(0) // the pattern still finds the markers
        expect(new Set(onPages).size).toBe(onPages.length) // each id used once
        expect(new Set(inDoc).size).toBe(inDoc.length)
        expect([...inDoc].sort()).toEqual([...onPages].sort())
    })

    it('the terms cite sections through policy-sections.ts, never a typed number', () => {
        const terms = read('src/routes/policies/terms.tsx')
        expect(terms).not.toMatch(/\bsections? \d/)
        expect(TERMS_SECTIONS.length).toBe(new Set(TERMS_SECTIONS.map(s => s.id)).size)
        expect(termsSection('about')).toBe('section 1')
    })
})
