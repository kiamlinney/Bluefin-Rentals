// The open tax questions for the accountant, read out of
// ImportantFiles/tax-todo.md so the admin Tax information page shows the
// document itself rather than a copy of it that could go stale.
//
// Pure: the page passes the file's text in (a Vite `?raw` import), and
// tests/tax-questions.test.ts parses the real file, failing if the document is
// reshaped so that a question would silently drop off the page.
//
// What it reads:
//   - the Summary table: `| 1 | Topic | What we do now | Needed before launch? |`
//   - each `## N. Topic` section's tick boxes: `- [ ] question` (indented lines
//     continue it) and table rows `| [ ] | Charge | We charge tax? | Doubt |`,
//     which become "Charge: is it taxable? We charge tax: Yes. Doubt: …".

export type TaxQuestion = { text: string; answered: boolean }

export type TaxQuestionTopic = {
    number: number
    topic: string
    /** The Summary table's "What we do now". */
    currentPosition: string
    /** The Summary table's "Needed before launch?", e.g. "Yes" or "Before the first return". */
    neededBeforeLaunch: string
    questions: TaxQuestion[]
}

/** Markdown inline formatting to plain text: links keep their words, emphasis and code marks go. */
export function plainText(markdown: string): string {
    return markdown
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/(^|[^*\w])\*([^*]+)\*(?=[^*\w]|$)/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())

const isTicked = (mark: string) => mark.toLowerCase() === 'x'

function summaryRows(markdown: string): Map<number, { topic: string; currentPosition: string; neededBeforeLaunch: string }> {
    const rows = new Map<number, { topic: string; currentPosition: string; neededBeforeLaunch: string }>()
    const summary = markdown.split(/^## Summary\s*$/m)[1]?.split(/^## /m)[0] ?? ''
    for (const line of summary.split('\n')) {
        const [number, topic, currentPosition, neededBeforeLaunch] = cells(line)
        if (!number || !/^\d+$/.test(number)) continue
        rows.set(Number(number), {
            topic: plainText(topic ?? ''),
            currentPosition: plainText(currentPosition ?? ''),
            neededBeforeLaunch: plainText(neededBeforeLaunch ?? ''),
        })
    }
    return rows
}

function sectionQuestions(body: string): TaxQuestion[] {
    // Each question as its lines of text; a `- [ ]` bullet can wrap onto indented lines.
    const found: { lines: string[]; answered: boolean; continues: boolean }[] = []

    for (const line of body.split('\n')) {
        const last = found[found.length - 1]
        const bullet = line.match(/^\s*- \[([ xX])\]\s+(.*)$/)
        const row = line.match(/^\|\s*\[([ xX])\]\s*\|/)
        if (last) last.continues = last.continues && !bullet && !row && /^\s{2,}\S/.test(line)

        if (bullet) {
            found.push({ lines: [bullet[2]!], answered: isTicked(bullet[1]!), continues: true })
        } else if (row) {
            const [, charge = '', weCharge = '', doubt = ''] = cells(line)
            const hasDoubt = doubt !== '' && doubt !== '—' && doubt !== '-'
            found.push({
                lines: [`${charge}: is it taxable? We charge tax: ${weCharge}.${hasDoubt ? ` Doubt: ${doubt}` : ''}`],
                answered: isTicked(row[1]!),
                continues: false,
            })
        } else if (last?.continues) {
            last.lines.push(line.trim())
        }
    }
    return found.map(q => ({ text: plainText(q.lines.join(' ')), answered: q.answered }))
}

export function parseTaxQuestions(markdown: string): TaxQuestionTopic[] {
    const summary = summaryRows(markdown)
    const topics: TaxQuestionTopic[] = []
    const headings = [...markdown.matchAll(/^## (\d+)\. (.+)$/gm)]

    for (const heading of headings) {
        const rest = markdown.slice(heading.index! + heading[0].length)
        const end = rest.search(/^## /m)
        // A section ends at the next heading or a `---` divider (before the meeting checklist).
        const sectionBody = (end === -1 ? rest : rest.slice(0, end)).split(/^---\s*$/m)[0]!
        const number = Number(heading[1])
        const row = summary.get(number)
        topics.push({
            number,
            topic: row?.topic ?? plainText(heading[2]!),
            currentPosition: row?.currentPosition ?? '',
            neededBeforeLaunch: row?.neededBeforeLaunch ?? '',
            questions: sectionQuestions(sectionBody),
        })
    }
    return topics
}

export const isTopicOpen = (topic: TaxQuestionTopic) => topic.questions.some(q => !q.answered)
