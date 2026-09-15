import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { TripQuote } from "@/lib/pricing.ts";
import { formatDateKey } from "@/lib/dates.ts";

// Formats a 'YYYY-MM-DD' key as "Mon, Aug 3".
//
// formatDayLabel goes through src/lib/dates.ts rather than the Date constructor:
// new Date('2026-08-03') is parsed as UTC midnight, which renders as Aug 2 for
// anyone west of Greenwich, so every row would show the day before the one
// being charged.
const formatDayLabel = (dateKey: string): string =>
    formatDateKey(dateKey, {
        weekday: "short",
        month: "short",
        day: "numeric",
    });

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
                className="w-full max-w-md bg-surface text-ink rounded-2xl shadow-2xl overflow-hidden"
                // Clicks inside the card must not bubble up to the backdrop's
                // close handler.
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-line">
                    <div>
                        <h2 className="text-lg font-bold">Price details</h2>
                        <p className="text-xs text-muted mt-0.5">{title}</p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close price details"
                        className="p-1.5 -mr-1.5 rounded-full hover:bg-subtle transition-colors cursor-pointer"
                    >
                        <X size={20} className="text-muted" />
                    </button>
                </div>

                <div className="px-6 py-4">
                    <p className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">
                        {quote.billableDays} {quote.billableDays === 1 ? "day" : "days"}
                    </p>

                    {/* A 3-week trip is 21 rows — the list scrolls, the totals below don't. */}
                    <div className="max-h-64 overflow-y-auto pr-1 space-y-1.5">
                        {quote.days.map((day) => (
                            <div key={day.date} className={rowClass}>
                                <span className="text-muted">
                                    {formatDayLabel(day.date)}
                                    {day.isOverride && (
                                        <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-pine-500">
                                            Special rate
                                        </span>
                                    )}
                                </span>
                                <span
                                    className={cn(
                                        "font-medium tabular-nums",
                                        day.isOverride ? "text-pine-700 font-semibold" : "text-ink"
                                    )}
                                >
                                    {formatMoney(day.price)}
                                </span>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 pt-4 border-t border-line space-y-2">
                        <div className={rowClass}>
                            <span className="text-muted">Subtotal</span>
                            <span className="font-medium text-ink tabular-nums">
                                {formatMoney(quote.subtotal)}
                            </span>
                        </div>

                        {quote.discountAmount > 0 && (
                            <div className={rowClass}>
                                <span className="text-pine-700">
                                    {quote.discountLabel} ({formatPercent(quote.discountPercent)})
                                </span>
                                <span className="font-medium text-pine-700 tabular-nums">
                                    −{formatMoney(quote.discountAmount)}
                                </span>
                            </div>
                        )}

                        {quote.extraDiscountAmount > 0 && (
                            <div className={rowClass}>
                                <span className="text-pine-700">
                                    {quote.extraDiscountLabel} ({formatPercent(quote.extraDiscountPercent)})
                                    <span className="ml-1.5 text-[10px] text-muted">
                                        applied after
                                    </span>
                                </span>
                                <span className="font-medium text-pine-700 tabular-nums">
                                    −{formatMoney(quote.extraDiscountAmount)}
                                </span>
                            </div>
                        )}

                        {quote.surchargeAmount > 0 && (
                            <div className={rowClass}>
                                <span className="text-muted">
                                    {quote.surchargeLabel} ({formatPercent(quote.surchargePercent)})
                                </span>
                                <span className="font-medium text-ink tabular-nums">
                                    +{formatMoney(quote.surchargeAmount)}
                                </span>
                            </div>
                        )}

                        {/* The refundable premium. Missing from this list until
                            now, which meant that on a refundable booking the
                            rows visibly didn't add up to the total underneath
                            them — the 10% was in the number on the card and
                            nowhere on the receipt explaining it. */}
                        {quote.refundableSurchargeAmount > 0 && (
                            <div className={rowClass}>
                                <span className="text-muted">
                                    {quote.refundableSurchargeLabel}
                                </span>
                                <span className="font-medium text-ink tabular-nums">
                                    +{formatMoney(quote.refundableSurchargeAmount)}
                                </span>
                            </div>
                        )}

                        {/* Last row before the total, and the only one with no
                            percentage next to it — both on purpose.

                            The order of the rows in this column is the order of
                            the arithmetic in calculateTripPrice, so the breakdown
                            can be read top to bottom as the total being built:
                            subtotal, then what comes off it, then what goes on
                            top. Delivery is applied after everything else because
                            it's a flat service charge that the duration discounts
                            deliberately don't touch (a 3-week trip pays the same
                            $140 as a 2-day one), and printing it above them would
                            imply it had been discounted along with the rate. */}
                        {quote.pickupFee > 0 && (
                            <div className={rowClass}>
                                <span className="text-muted">{quote.pickupFeeLabel}</span>
                                <span className="font-medium text-ink tabular-nums">
                                    +{formatMoney(quote.pickupFee)}
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-line flex justify-between items-baseline">
                        <span className="font-bold">Total</span>
                        <span className="text-xl font-bold tabular-nums">
                            {formatMoney(quote.total)}
                        </span>
                    </div>

                    <p className="text-xs text-muted mt-3">
                        Not including tax.
                    </p>
                </div>
            </div>
        </div>
    );
}
