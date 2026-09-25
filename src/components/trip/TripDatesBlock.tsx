import { ArrowRight } from 'lucide-react'
import { formatBusinessDate, formatBusinessTime } from '@/lib/dates.ts'

// The trip's start and end, side by side.
//
// Times are rendered in the business's timezone, not the viewer's: a customer
// booking from California picked a 10am pickup and should be shown 10am, not
// 7am. That rule is why this takes the raw timestamps and formats them here
// rather than accepting pre-formatted strings.

const DATE_FORMAT = { weekday: 'short', month: 'short', day: 'numeric' } as const

function Endpoint({
    label,
    timestamp,
    struck,
}: {
    label: string
    timestamp: string
    struck: boolean
}) {
    return (
        <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted">{label}</h4>
            <p className={`text-lg font-bold mt-1 ${struck ? 'text-muted line-through' : 'text-ink'}`}>
                {formatBusinessDate(timestamp, DATE_FORMAT)}
            </p>
            <p className={`text-sm ${struck ? 'text-muted line-through' : 'text-muted'}`}>
                {formatBusinessTime(timestamp)} CST
            </p>
        </div>
    )
}

export function TripDatesBlock({
    start,
    end,
    struck = false,
}: {
    start: string
    end: string
    /**
     * Strikes the dates through for a cancelled trip — the treatment Turo uses,
     * and the clearest way to say "this was going to happen and now isn't"
     * without removing the information.
     */
    struck?: boolean
}) {
    return (
        <div className="flex items-center gap-4 sm:gap-8">
            <Endpoint label="Trip start" timestamp={start} struck={struck} />
            <ArrowRight className="text-ink-400 shrink-0 mt-4" size={20} />
            <Endpoint label="Trip end" timestamp={end} struck={struck} />
        </div>
    )
}
