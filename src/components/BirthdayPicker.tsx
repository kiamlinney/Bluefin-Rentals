import { useEffect, useRef, useState } from "react"
import { DayPicker } from "react-day-picker"
import "react-day-picker/style.css"
import { Calendar } from "lucide-react"
import { dateKeyToLocalDate, toDateKey } from "@/lib/pricing.ts"
import { formatDateKey } from "@/lib/dates.ts"
import { cn } from "@/lib/utils.ts"

// Light-theme calendar, in the spirit of src/components/admin/MonthPicker.tsx
// but with the brand green as the selected colour and month/year dropdowns.
//
// ── Only leaf classes are overridden here, on purpose ─────────────────────────
//
// DayPicker's `classNames` prop REPLACES an entry rather than merging with it,
// so overriding a structural key silently drops the layout rules that come with
// it in react-day-picker/style.css. Two of those bite specifically with
// captionLayout="dropdown":
//
//   • `dropdown` is the real <select>, which style.css keeps invisible
//     (opacity: 0; position: absolute) and stretches over `dropdown_root`.
//     The visible text is a separate `caption_label` span underneath it.
//     Styling `dropdown` as if it were the visible control brings the native
//     select back and renders it NEXT TO the label — every month and year
//     drawn twice.
//   • `.rdp-nav` is absolutely positioned to the top-right of `.rdp-root`.
//     Replacing `root`, `months` or `nav` removes that anchor and the arrows
//     land on top of the dropdowns.
//
// So: structure comes from the stylesheet, and only `caption_label` (the part
// that is actually visible) and the grid leaves get styled.
const birthdayCalendarClassNames = {
    month_caption: "flex items-center h-11",
    // The visible face of both dropdowns — the invisible <select> sits over it
    // and handles the interaction, so this only has to look like a control.
    caption_label:
        "inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white " +
        "px-2.5 py-1.5 text-sm text-gray-900 " +
        "hover:bg-gray-50 transition-colors cursor-pointer",
    button_previous: [
        "w-7 h-7 mr-1 rounded-md",
        "border border-gray-200",
        "inline-flex items-center justify-center",
        "bg-transparent hover:bg-gray-50",
        "transition-colors duration-150",
        "cursor-pointer",
    ].join(" "),
    button_next: [
        "w-7 h-7 rounded-md",
        "border border-gray-200",
        "inline-flex items-center justify-center",
        "bg-transparent hover:bg-gray-50",
        "transition-colors duration-150",
        "cursor-pointer",
    ].join(" "),
    month_grid: "border-collapse mt-2",
    weekdays: "flex",
    weekday: "w-9 text-center text-[10px] font-medium text-gray-400 uppercase tracking-widest pb-1",
    week: "flex mt-1",
    day: "w-9 h-9 text-center text-sm p-0",
    day_button:
        "w-9 h-9 rounded-full text-sm font-medium text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none cursor-pointer",
    today: "[&>button]:border [&>button]:border-gray-900",
    selected: "[&>button]:bg-[#152110] [&>button]:text-white [&>button]:hover:bg-[#1d2f17]",
    disabled: "[&>button]:text-gray-300 [&>button]:cursor-not-allowed [&>button]:hover:bg-transparent",
    outside: "[&>button]:text-gray-300 [&>button]:opacity-60",
    hidden: "invisible",
}

// The oldest year offered in the year dropdown. A renter born before this is
// not a case worth carrying a longer list for.
const EARLIEST_BIRTH_YEAR = 1920

// Renters must be adults. This is the newest selectable day, and also the month
// the calendar opens on when there's no value yet — landing on the current month
// would mean scrolling back two decades to reach anything selectable.
function eighteenYearsAgo(): Date {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 18)
    d.setHours(0, 0, 0, 0)
    return d
}

export function BirthdayPicker({
    value,
    onChange,
    hasError = false,
    id,
}: {
    /** 'YYYY-MM-DD', or '' when unset. */
    value: string
    onChange: (value: string) => void
    hasError?: boolean
    id?: string
}) {
    const [isOpen, setIsOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    // Click-outside-close pattern, same as MonthPicker
    useEffect(() => {
        if (!isOpen) return
        function handleClick(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClick)
        return () => document.removeEventListener("mousedown", handleClick)
    }, [isOpen])

    // dateKeyToLocalDate, not `new Date(value)`: the Date constructor reads a
    // date-only string as UTC midnight, which lands on the day before in every
    // US timezone — the picker would highlight the 14th for a birthday of the 15th.
    const selected = dateKeyToLocalDate(value) ?? undefined
    const maxDate = eighteenYearsAgo()

    const label = value
        ? formatDateKey(value, { month: "long", day: "numeric", year: "numeric" })
        : "Select your date of birth"

    return (
        <div ref={containerRef} className="relative">
            <button
                id={id}
                type="button"
                onClick={() => setIsOpen((o) => !o)}
                className={cn(
                    "w-full flex items-center justify-between gap-2 rounded-lg border bg-white",
                    "px-3 py-2.5 text-sm text-left transition-colors cursor-pointer",
                    "focus:outline-none focus:border-[#152110]",
                    hasError ? "border-red-500" : "border-gray-300 hover:border-gray-400",
                    value ? "text-gray-900" : "text-gray-400",
                )}
            >
                {label}
                <Calendar size={16} className="text-gray-400 flex-shrink-0" />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-2 z-[200] bg-white border border-gray-200 rounded-xl shadow-lg p-4">
                    <DayPicker
                        mode="single"
                        // The whole point of moving off <input type="date">: month
                        // and year become dropdowns, so reaching 1995 is one click
                        // rather than three hundred taps on the back arrow.
                        captionLayout="dropdown"
                        startMonth={new Date(EARLIEST_BIRTH_YEAR, 0)}
                        endMonth={maxDate}
                        defaultMonth={selected ?? maxDate}
                        selected={selected}
                        onSelect={(date) => {
                            if (date) {
                                onChange(toDateKey(date))
                                setIsOpen(false)
                            }
                        }}
                        disabled={{ after: maxDate }}
                        classNames={birthdayCalendarClassNames}
                    />
                </div>
            )}
        </div>
    )
}