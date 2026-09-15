// The radio indicator shared by the checkout page's option groups (booking rate
// and payment mode). Extracted so two groups stacked on the same screen can't
// drift apart visually.
//
// The real <input type="radio"> stays at each call site, kept accessible with
// `sr-only` — this only draws the dot.
export function RadioDot({ checked }: { checked: boolean }) {
    return (
        <span
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                checked ? 'border-brand' : 'border-ink-400'
            }`}
        >
            {checked && <span className="w-2.5 h-2.5 rounded-full bg-brand" />}
        </span>
    )
}