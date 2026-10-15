// The admin Tax information page lists the accountant's open questions by
// parsing ImportantFiles/tax-todo.md. This parses the real file, so reshaping
// the document in a way that would make a question silently vanish from the
// page fails here instead.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isTopicOpen, parseTaxQuestions, plainText } from '../src/lib/tax-questions'

const doc = readFileSync(new URL('../ImportantFiles/tax-todo.md', import.meta.url), 'utf8')
const topics = parseTaxQuestions(doc)

// The numbered sections, where every tick box is a question (the intro mentions `[ ]` too).
const sections = doc.slice(doc.search(/^## 1\. /m), doc.search(/^## What to bring/m))
const boxes = (mark: RegExp) => (sections.match(mark) ?? []).length

describe('accountant questions from tax-todo.md', () => {
    it('finds every topic in the Summary table, numbered 1 to 8, each with its summary columns', () => {
        expect(topics.map(t => t.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
        for (const topic of topics) {
            expect(topic.topic).not.toBe('')
            expect(topic.currentPosition).not.toBe('')
            expect(topic.neededBeforeLaunch).not.toBe('')
            expect(topic.questions.length).toBeGreaterThan(0)
        }
        expect(topics[0]!.topic).toBe('Sales tax permit and registration')
    })

    it('reads every tick box in the file, open and answered, and nothing else', () => {
        const parsed = topics.flatMap(t => t.questions)
        expect(parsed.filter(q => !q.answered)).toHaveLength(boxes(/\[ \]/g))
        expect(parsed.filter(q => q.answered)).toHaveLength(boxes(/\[[xX]\]/g))
    })

    it("turns item 4's table into questions, one per charge", () => {
        const item4 = topics.find(t => t.number === 4)!
        const rows = item4.questions.filter(q => q.text.includes(': is it taxable?'))
        expect(rows).toHaveLength(14)
        expect(rows.find(q => q.text.includes('Prepaid refuel'))!.text)
            .toBe('Prepaid refuel ($70/trip): is it taxable? We charge tax: Yes. Doubt: Motor fuel is generally exempt from sales tax')
        expect(rows.find(q => q.text.includes('Child seat'))!.text).toBe('Child seat ($25/trip): is it taxable? We charge tax: Yes.')
    })

    it('joins wrapped lines and leaves no markdown in the text', () => {
        const all = topics.flatMap(t => t.questions.map(q => q.text))
        for (const text of all) {
            expect(text).not.toMatch(/\*\*|`|\]\(/)
            expect(text).not.toMatch(/\s{2}/)
        }
        const refundMonth = topics.find(t => t.number === 7)!.questions[0]!.text
        expect(refundMonth).toMatch(/^Are those two conventions \(sales counted .* which may already have been filed\.$/)
    })

    it('counts a topic as open while any of its boxes is unticked', () => {
        const parsed = parseTaxQuestions(doc.replace(/^- \[ \] Please register/m, '- [x] Please register'))
        const registration = parsed.find(t => t.number === 1)!
        expect(registration.questions[0]!.answered).toBe(true)
        expect(isTopicOpen(registration)).toBe(true)
        const allTicked = parseTaxQuestions(doc.replace(/\[ \]/g, '[x]'))
        expect(allTicked.some(isTopicOpen)).toBe(false)
    })

    it('strips links, bold, italics and code', () => {
        expect(plainText('**Yes** see [tax.md](tax.md), `TAXABILITY` and *Code* only'))
            .toBe('Yes see tax.md, TAXABILITY and Code only')
    })
})
