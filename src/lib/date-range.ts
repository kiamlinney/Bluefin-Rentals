// What a click on the search bar's range calendar does.
//
// DayPicker's own range mode only ever extends the selection, so once both ends
// were chosen there was no way to start a fresh range short of Reset. This rule
// follows which end the guest is filling (the From or Until field they opened
// the calendar from), and starts over whenever the click can't be that end.
//
// Pure and compared by date key, so the time of day on a Date never matters.

import { toDateKey } from './pricing.ts'

export type RangeFocus = 'start' | 'end'
export type PickedRange = { start?: Date; end?: Date }

export function nextRange(
    current: PickedRange,
    clicked: Date,
    focus: RangeFocus,
): { range: PickedRange; focus: RangeFocus } {
    const key = toDateKey(clicked)

    // Filling Until, and the day can end this trip: only the end moves.
    if (focus === 'end' && current.start && key >= toDateKey(current.start)) {
        return { range: { start: current.start, end: clicked }, focus: 'start' }
    }

    // Filling From, and the trip still ends on or after this day: keep that end.
    if (focus === 'start' && current.end && key <= toDateKey(current.end)) {
        return { range: { start: clicked, end: current.end }, focus: 'end' }
    }

    // Anything else starts a new trip on this day.
    return { range: { start: clicked, end: undefined }, focus: 'end' }
}
