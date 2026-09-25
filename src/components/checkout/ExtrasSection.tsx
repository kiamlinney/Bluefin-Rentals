import { Check } from 'lucide-react'
import { EXTRAS, extraPriceLabel, resolveExtras } from '@/lib/extras.ts'

// The extras picker. Shared by checkout (where the selection is really priced
// and charged) and the post-booking request page (where it's a request to the
// host), so the catalogue a guest sees cannot fork between the two.
//
// Styled after BookingRateSection — same card, same divided rows — because they
// sit next to each other on the payment step and should read as one control
// surface. Checkboxes rather than radios: extras aren't mutually exclusive.

const formatMoney = (amount: number): string => `$${amount.toFixed(2)}`

// Checkbox twin of RadioDot. Local rather than a sibling component because
// nothing else needs a square one.
function CheckBox({ checked }: { checked: boolean }) {
    return (
        <span
            aria-hidden
            className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                checked ? 'bg-brand border-brand' : 'bg-surface border-line'
            }`}
        >
            {checked && <Check className="w-3.5 h-3.5 text-on-brand" strokeWidth={3} />}
        </span>
    )
}

export function ExtrasSection({
    value,
    onChange,
    billableDays,
    disabled = false,
    heading = 'Add extras',
    subheading,
    exclude = [],
    emptyMessage,
}: {
    value: string[]
    onChange: (ids: string[]) => void
    /** Drives the "× N days" line and the priced total for per-day extras. */
    billableDays: number
    disabled?: boolean
    heading?: string
    subheading?: string
    /**
     * Ids to leave out entirely — the extras a trip already has.
     *
     * Hidden rather than shown-and-disabled: a greyed-out "Unlimited mileage"
     * on a form headed "Add extras" still reads as something you might be able
     * to buy again. What the trip already has is stated by TripExtrasSection on
     * the page this form is reached from.
     */
    exclude?: string[]
    /** Shown when every extra is excluded. */
    emptyMessage?: string
}) {
    const available = EXTRAS.filter(extra => !exclude.includes(extra.id))

    const toggle = (id: string) => {
        if (disabled) return
        onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])
    }

    // Priced through the same function the server charges from, so the figure
    // on each row is the figure that ends up on the card.
    const { items } = resolveExtras(EXTRAS.map(e => e.id), billableDays)
    const amountFor = (id: string) => items.find(item => item.id === id)?.amount ?? 0

    return (
        <div className="mb-8">
            <h2 className="text-2xl font-bold text-ink mb-1">{heading}</h2>
            <p className="text-sm text-muted mb-4">
                {subheading ?? 'Optional. Add them now or skip — nothing here is required.'}
            </p>

            {available.length === 0 ? (
                <div className="bg-surface border border-line rounded-2xl p-5">
                    <p className="text-ink">
                        {emptyMessage ?? 'You already have every extra we offer on this trip.'}
                    </p>
                </div>
            ) : (
            <div className="bg-surface border border-line rounded-2xl divide-y divide-line shadow-sm">
                {available.map((extra) => {
                    const checked = value.includes(extra.id)
                    const amount = amountFor(extra.id)

                    return (
                        <label
                            key={extra.id}
                            className={`flex items-start gap-3 p-4 ${
                                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                            }`}
                        >
                            <input
                                type="checkbox"
                                className="sr-only"
                                checked={checked}
                                onChange={() => toggle(extra.id)}
                                disabled={disabled}
                            />
                            <CheckBox checked={checked} />

                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-baseline gap-4">
                                    <span className="text-ink font-medium">{extra.name}</span>
                                    <span className="font-bold text-ink tabular-nums whitespace-nowrap">
                                        {extraPriceLabel(extra)}
                                    </span>
                                </div>

                                <p className="text-sm text-muted mt-1">{extra.description}</p>

                                {/* Only for per-day extras, and only once there's
                                    a trip length to multiply by: "$80/day" alone
                                    understates a week-long rental by $480. */}
                                {extra.billing === 'per-day' && billableDays > 0 && (
                                    <p className="text-sm text-muted mt-1 tabular-nums">
                                        × {billableDays} {billableDays === 1 ? 'day' : 'days'} ={' '}
                                        <span className="font-semibold text-ink">{formatMoney(amount)}</span>
                                    </p>
                                )}
                            </div>
                        </label>
                    )
                })}
            </div>
            )}
        </div>
    )
}
