// What a click on the search bar's two-month calendar does (nextRange).

import { describe, expect, it } from 'vitest'
import { nextRange } from '../src/lib/date-range'
import { dateKeyToLocalDate, toDateKey } from '../src/lib/pricing'

const d = (key: string) => dateKeyToLocalDate(key)!
const keys = (r: { range: { start?: Date; end?: Date }; focus: string }) => ({
    start: r.range.start && toDateKey(r.range.start),
    end: r.range.end && toDateKey(r.range.end),
    focus: r.focus,
})

describe('nextRange', () => {
    it('starts a trip, then ends it', () => {
        const first = nextRange({}, d('2026-10-13'), 'start')
        expect(keys(first)).toEqual({ start: '2026-10-13', end: undefined, focus: 'end' })
        const second = nextRange(first.range, d('2026-10-16'), first.focus)
        expect(keys(second)).toEqual({ start: '2026-10-13', end: '2026-10-16', focus: 'start' })
    })

    it('starts over when the end would come before the start', () => {
        expect(keys(nextRange({ start: d('2026-10-13') }, d('2026-10-11'), 'end')))
            .toEqual({ start: '2026-10-11', end: undefined, focus: 'end' })
    })

    it('can start a fresh trip once both ends are set', () => {
        const done = { start: d('2026-10-13'), end: d('2026-10-16') }
        expect(keys(nextRange(done, d('2026-10-20'), 'start')))
            .toEqual({ start: '2026-10-20', end: undefined, focus: 'end' })
    })

    it('opened from From, moves only the start while the end still follows it', () => {
        const done = { start: d('2026-10-13'), end: d('2026-10-16') }
        expect(keys(nextRange(done, d('2026-10-11'), 'start')))
            .toEqual({ start: '2026-10-11', end: '2026-10-16', focus: 'end' })
    })

    it('opened from Until, moves only the end', () => {
        const done = { start: d('2026-10-13'), end: d('2026-10-16') }
        expect(keys(nextRange(done, d('2026-10-20'), 'end')))
            .toEqual({ start: '2026-10-13', end: '2026-10-20', focus: 'start' })
        expect(keys(nextRange(done, d('2026-10-14'), 'end')))
            .toEqual({ start: '2026-10-13', end: '2026-10-14', focus: 'start' })
    })

    it('opened from Until with no start yet, picks the start', () => {
        expect(keys(nextRange({}, d('2026-10-13'), 'end')))
            .toEqual({ start: '2026-10-13', end: undefined, focus: 'end' })
    })
})
