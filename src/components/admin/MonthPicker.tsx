import { useEffect, useRef, useState } from "react"
import { DayPicker } from "react-day-picker"
import "react-day-picker/style.css"
import { ChevronDown, ChevronUp, CalendarFold } from "lucide-react"

// Light-theme calendar
// Defined outside the component so it's created once, not recreated on every render.
const miniCalendarClassNames = {
    root: "p-0 font-sans",
    months: "flex flex-col",
    month: "space-y-3",
    month_caption: "flex justify-center items-center h-9 relative",
    caption_label: "text-sm font-semibold text-gray-900 tracking-wide",
    nav: "w-full flex items-center justify-center relative h-5",
    button_previous: [
        "absolute left-2 top-0",
        "w-7 h-7 rounded-md",
        "border border-gray-200",
        "inline-flex items-center justify-center",
        "bg-transparent hover:bg-gray-50",
        "transition-colors duration-150",
        "cursor-pointer",
    ].join(" "),
    button_next: [
        "absolute right-2 top-0",
        "w-7 h-7 rounded-md",
        "border border-gray-200",
        "inline-flex items-center justify-center",
        "bg-transparent hover:bg-gray-50",
        "transition-colors duration-150",
        "cursor-pointer",
    ].join(" "),
    month_grid: "w-full border-collapse",
    weekdays: "flex",
    weekday: "w-9 text-center text-[10px] font-medium text-gray-400 uppercase tracking-widest pb-1",
    week: "flex mt-1",
    day: "w-9 h-9 text-center text-sm p-0",
    day_button:
        "w-9 h-9 rounded-full text-sm font-medium text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none cursor-pointer",
    today: "[&>button]:border [&>button]:border-gray-900",
    selected: "[&>button]:bg-green-700 [&>button]:text-white [&>button]:hover:bg-green-800",
    disabled: "[&>button]:text-gray-300 [&>button]:cursor-not-allowed [&>button]:hover:bg-transparent",
    outside: "[&>button]:text-gray-300 [&>button]:opacity-60",
    hidden: "invisible",
}

export function MonthPicker({
    currentDate,
    onSelectDate,
    onJumpToToday,
}: {
    currentDate: Date                   // the date currently driving the displayed month label
    onSelectDate: (date: Date) => void  // called when a day is clicked in mini calendar
    onJumpToToday: () => void
}) {
    const [isOpen, setIsOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    // Click-outside-close pattern
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

    const monthLabel = currentDate
        .toLocaleDateString("en-US", { month: "long", year: "numeric" })
        .toUpperCase()

    // Today at midnight - used to disable past dates in the picker. Since the main grid's dateRange never includes days before today either
    const todayMidnight = new Date()
    todayMidnight.setHours(0, 0, 0, 0)

    return (
        <div ref={containerRef} className="relative flex items-center gap-16">
            {/* Month label trigger */}
            <button
                type="button"
                onClick={() => setIsOpen((o) => !o)}
                className="flex items-center gap-2 text-sm text-emerald-700 hover:text-emerald-800 cursor-pointer"
            >
                {monthLabel}
                {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {/* Calendar icon */}
            <button
                type="button"
                onClick={onJumpToToday}
                className="w-8 h-8 rounded-md border border-gray-200 flex items-center justify-center hober:bg-gray-50 cursor-pointer"
            >
                <CalendarFold size={14}/>
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-2 z-[200] bg-white border border-gray-200 rounded-xl shadow-lg p-4">
                    <DayPicker
                        mode="single"
                        selected={currentDate}
                        defaultMonth={currentDate}
                        onSelect={(date) => {
                            if (date) {
                                onSelectDate(date)
                                setIsOpen(false)
                            }
                        }}
                        disabled={{ before: todayMidnight }}
                        classNames={miniCalendarClassNames}
                    />
                </div>
            )}
        </div>
    )
}

























