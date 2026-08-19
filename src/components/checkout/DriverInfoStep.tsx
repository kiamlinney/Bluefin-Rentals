import { useState } from 'react'
import { Info } from 'lucide-react'
import { getProfile, saveDriverInfo } from '@/lib/db'
import { BirthdayPicker } from '@/components/BirthdayPicker.tsx'
import { cn } from '@/lib/utils.ts'

type FormField =
    | 'fullName'
    | 'dateOfBirth'
    | 'email'
    | 'phone'
    | 'address'
    | 'city'
    | 'state'
    | 'zip'

// Every field the customer has to supply, with the message shown under it when
// it's blank. Driving validation off this list rather than a bare array of keys
// is what lets each input carry its own error the way the mock shows, instead of
// one "please fill in all required fields" line at the bottom.
const REQUIRED: { field: FormField; message: string }[] = [
    { field: 'fullName', message: 'Enter your full legal name' },
    { field: 'dateOfBirth', message: 'Select your date of birth' },
    { field: 'phone', message: 'Enter a mobile number' },
    { field: 'address', message: 'Enter your street address' },
    { field: 'city', message: 'Enter your city' },
    { field: 'state', message: 'Enter your state' },
    { field: 'zip', message: 'Enter your ZIP code' },
]

const labelClass = 'block text-sm font-medium text-gray-900 mb-1.5'
const helpClass = 'text-xs text-gray-500 mt-1.5'

function inputClass(hasError: boolean): string {
    return cn(
        'w-full bg-white border rounded-lg px-3 py-2.5 text-gray-900 text-sm',
        'placeholder:text-gray-400 focus:outline-none transition-colors',
        hasError
            ? 'border-red-500 focus:border-red-500'
            : 'border-gray-300 hover:border-gray-400 focus:border-[#152110]',
    )
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null
    return <p className="text-xs text-red-600 mt-1.5">{message}</p>
}

export function DriverInfoStep({
    existingProfile,
    onComplete,
}: {
    existingProfile: Awaited<ReturnType<typeof getProfile>>
    onComplete: () => void
}) {
    const [form, setForm] = useState({
        fullName:    existingProfile?.full_name     ?? '',
        dateOfBirth: existingProfile?.date_of_birth ?? '',
        email:       existingProfile?.email         ?? '',
        phone:       existingProfile?.phone         ?? '',
        address:     existingProfile?.address       ?? '',
        city:        existingProfile?.city          ?? '',
        state:       existingProfile?.state         ?? '',
        zip:         existingProfile?.zip           ?? '',
    })

    // Per-field rather than a single string: the mock marks the offending input
    // red and prints the reason beneath it.
    const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({})
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    // Returns a change handler for any field — avoids writing one per input.
    // Clearing the field's error on edit means a red border goes away as soon as
    // the customer starts fixing it, not on the next submit.
    const update = (field: FormField) =>
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const { value } = e.target
            setForm(prev => ({ ...prev, [field]: value }))
            setErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev))
        }

    const setDateOfBirth = (value: string) => {
        setForm(prev => ({ ...prev, dateOfBirth: value }))
        setErrors(prev => (prev.dateOfBirth ? { ...prev, dateOfBirth: undefined } : prev))
    }

    const handleSubmit = async () => {
        const nextErrors: Partial<Record<FormField, string>> = {}
        for (const { field, message } of REQUIRED) {
            if (!form[field]?.trim()) nextErrors[field] = message
        }

        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors)
            setSubmitError(null)
            return
        }

        setSaving(true)
        setErrors({})
        setSubmitError(null)
        try {
            await saveDriverInfo({ data: form })
            onComplete()
        } catch (e: unknown) {
            setSubmitError(e instanceof Error ? e.message : 'Failed to save information')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div>
            <h2 className="text-2xl font-bold text-gray-900">Primary driver</h2>
            <p className="text-gray-500 text-sm mt-1 mb-6">
                Required once — future bookings reuse it.
            </p>

            <div className="space-y-5">
                {/* One field rather than first/last: profiles stores a single
                    full_name, which is also what Stripe Identity matches the
                    licence against. */}
                <div>
                    <label className={labelClass} htmlFor="fullName">Full legal name</label>
                    <input
                        id="fullName"
                        className={inputClass(!!errors.fullName)}
                        placeholder="As it appears on your license"
                        value={form.fullName}
                        onChange={update('fullName')}
                    />
                    <FieldError message={errors.fullName} />
                </div>

                <div>
                    <label className={labelClass} htmlFor="dateOfBirth">Date of birth</label>
                    <BirthdayPicker
                        id="dateOfBirth"
                        value={form.dateOfBirth}
                        onChange={setDateOfBirth}
                        hasError={!!errors.dateOfBirth}
                    />
                    <FieldError message={errors.dateOfBirth} />
                </div>

                {/* The country segment is fixed at US +1 rather than a select:
                    it pairs the field the way the mock does without adding a
                    value nothing downstream reads. */}
                <div>
                    <label className={labelClass} htmlFor="phone">Mobile number</label>
                    <div className="flex">
                        {/* shrink-0 + nowrap: without them the flex row squeezes
                            this down to the width of "US" and wraps the "+1". */}
                        <span className="inline-flex items-center shrink-0 whitespace-nowrap px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-sm text-gray-600">
                            US +1
                        </span>
                        <input
                            id="phone"
                            type="tel"
                            className={cn(inputClass(!!errors.phone), 'rounded-l-none')}
                            placeholder="(612) 555-0100"
                            value={form.phone}
                            onChange={update('phone')}
                        />
                    </div>
                    <FieldError message={errors.phone} />
                    <p className={helpClass}>
                        By providing a phone number, you consent to receive automated text
                        messages with trip or account updates.
                    </p>
                </div>

                <div>
                    <label className={labelClass} htmlFor="email">Email</label>
                    <input
                        id="email"
                        type="email"
                        className={inputClass(false)}
                        placeholder="name@example.com"
                        value={form.email}
                        onChange={update('email')}
                    />
                </div>

                <div>
                    <label className={labelClass} htmlFor="address">Street address</label>
                    <input
                        id="address"
                        className={inputClass(!!errors.address)}
                        placeholder="123 Main St"
                        value={form.address}
                        onChange={update('address')}
                    />
                    <FieldError message={errors.address} />
                </div>

                <div className="grid grid-cols-5 gap-3">
                    <div className="col-span-2">
                        <label className={labelClass} htmlFor="city">City</label>
                        <input
                            id="city"
                            className={inputClass(!!errors.city)}
                            placeholder="Minneapolis"
                            value={form.city}
                            onChange={update('city')}
                        />
                        <FieldError message={errors.city} />
                    </div>
                    <div>
                        <label className={labelClass} htmlFor="state">State</label>
                        <input
                            id="state"
                            className={inputClass(!!errors.state)}
                            placeholder="MN"
                            maxLength={2}
                            value={form.state}
                            onChange={update('state')}
                        />
                        <FieldError message={errors.state} />
                    </div>
                    <div className="col-span-2">
                        <label className={labelClass} htmlFor="zip">ZIP code</label>
                        <input
                            id="zip"
                            className={inputClass(!!errors.zip)}
                            placeholder="55401"
                            maxLength={5}
                            value={form.zip}
                            onChange={update('zip')}
                        />
                        <FieldError message={errors.zip} />
                    </div>
                </div>

                <div className="flex gap-3 items-start bg-blue-50 rounded-xl p-4">
                    <Info size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-900">
                        Next you'll verify your ID with a photo of your license — it takes
                        about a minute, and only has to be done once.
                    </p>
                </div>
            </div>

            {submitError && <p className="text-red-600 text-sm mt-4">{submitError}</p>}

            <button
                onClick={handleSubmit}
                disabled={saving}
                className="mt-6 w-full py-3.5 bg-[#152110] hover:bg-[#1d2f17] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors cursor-pointer"
            >
                {saving ? 'Saving...' : 'Continue to ID verification'}
            </button>
        </div>
    )
}