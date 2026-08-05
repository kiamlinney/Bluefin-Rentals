import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { TripQuote } from "@/lib/pricing.ts";

// Formats a 'YYYY-MM-DD' key as "Mon, Aug 3".
//
// The parts are pulled apart and fed to the Date constructor individually
// rather than passing the string — new Date('2026-08-03') is parsed as UTC
// midnight, which renders as Aug 2 for anyone west of Greenwich, so every row
// would show the day before the one being charged.
const formatDayLabel = (dateKey: string): string => {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
    return date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
    });
};

const formatMoney = (amount: number): string =>
    `$${amount.toFixed(2)}`;

const formatPercent = (percent: number): string =>
    `${Math.round(percent * 100)}%`;

export function PriceBreakdown({
    quote,
    title,
    onClose,
}: {
    quote: TripQuote;
    title: string;
    onClose: () => void;
}) {
    // Escape closes
    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [onClose]);

    const rowClass = "flex justify-between items-baseline text-sm";

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md bg-white text-black rounded-2xl shadow-2xl overflow-hidden"
                // Clicks inside the card must not bubble up to the backdrop's
                // close handler.
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">Price details</h2>
                        <p className="text-xs text-gray-500 mt-0.5">{title}</p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close price details"
                        className="p-1.5 -mr-1.5 rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
                    >
                        <X size={20} className="text-gray-600" />
                    </button>
                </div>

                <div className="px-6 py-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                        {quote.billableDays} {quote.billableDays === 1 ? "day" : "days"}
                    </p>

                    {/* A 3-week trip is 21 rows — the list scrolls, the totals below don't. */}
                    <div className="max-h-64 overflow-y-auto pr-1 space-y-1.5">
                        {quote.days.map((day) => (
                            <div key={day.date} className={rowClass}>
                                <span className="text-gray-700">
                                    {formatDayLabel(day.date)}
                                    {day.isOverride && (
                                        <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[#3a7d2c]">
                                            Special rate
                                        </span>
                                    )}
                                </span>
                                <span
                                    className={cn(
                                        "font-medium tabular-nums",
                                        day.isOverride ? "text-[#2a4a1e] font-semibold" : "text-gray-900"
                                    )}
                                >
                                    {formatMoney(day.price)}
                                </span>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                        <div className={rowClass}>
                            <span className="text-gray-700">Subtotal</span>
                            <span className="font-medium text-gray-900 tabular-nums">
                                {formatMoney(quote.subtotal)}
                            </span>
                        </div>

                        {quote.discountAmount > 0 && (
                            <div className={rowClass}>
                                <span className="text-[#2a4a1e]">
                                    {quote.discountLabel} ({formatPercent(quote.discountPercent)})
                                </span>
                                <span className="font-medium text-[#2a4a1e] tabular-nums">
                                    −{formatMoney(quote.discountAmount)}
                                </span>
                            </div>
                        )}

                        {quote.extraDiscountAmount > 0 && (
                            <div className={rowClass}>
                                <span className="text-[#2a4a1e]">
                                    {quote.extraDiscountLabel} ({formatPercent(quote.extraDiscountPercent)})
                                    <span className="ml-1.5 text-[10px] text-gray-500">
                                        applied after
                                    </span>
                                </span>
                                <span className="font-medium text-[#2a4a1e] tabular-nums">
                                    −{formatMoney(quote.extraDiscountAmount)}
                                </span>
                            </div>
                        )}

                        {quote.surchargeAmount > 0 && (
                            <div className={rowClass}>
                                <span className="text-gray-700">
                                    {quote.surchargeLabel} ({formatPercent(quote.surchargePercent)})
                                </span>
                                <span className="font-medium text-gray-900 tabular-nums">
                                    +{formatMoney(quote.surchargeAmount)}
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-300 flex justify-between items-baseline">
                        <span className="font-bold text-gray-900">Total</span>
                        <span className="text-xl font-bold text-gray-900 tabular-nums">
                            {formatMoney(quote.total)}
                        </span>
                    </div>

                    <p className="text-xs text-gray-500 mt-3">
                        Including tax and all fees.
                    </p>
                </div>
            </div>
        </div>
    );
}
