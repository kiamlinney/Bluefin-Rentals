import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Star, X } from 'lucide-react'
import { formatBusinessDate } from '@/lib/dates.ts'
import { displayName } from '@/lib/profile.ts'
import { startIdentityVerification, VERIFICATION_RETURN_PARAM } from '@/lib/identity.ts'
import type { UserProfileView } from '@/types.ts'

// The signed-in user's own profile, on /profile. The unverified rows are
// actions and there's an edit button.
//
// This used to have an admin variant for /admin/user/$userId. Owners see a
// customer on the CRM page (/admin/customers/$userId) now, which has far more
// on it than this layout could hold.
export function UserProfile({ profile }: { profile: UserProfileView }) {
    const name = displayName(profile)
    const firstName = name.split(' ')[0]

    // profiles.created_at is nullable, unlike bookings.created_at.
    const joined = profile.created_at
        ? formatBusinessDate(profile.created_at, { month: 'short', year: 'numeric' })
        : null

    const tripCount = profile.num_trips ?? 0

    const avatarBg = 'bg-subtle'

    // There are no email_verified / phone_verified columns — "verified" here
    // means the column holds a value. phone defaults to '' rather than null, so
    // both falsy cases have to be covered.
    const hasEmail = Boolean(profile.email)
    const hasPhone = Boolean(profile.phone)
    const allVerified = Boolean(profile.identity_verified) && hasEmail && hasPhone

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">

            {/* LEFT COLUMN — identity and verification */}
            <div>
                {/* Every avatar in this app is an initial in a circle
                    (TripCard, SelectionPanel, Navbar, the reservation page), so
                    this is one too rather than the generic glyph. */}
                <div
                    className={`w-24 h-24 rounded-full ${avatarBg} flex items-center justify-center text-muted font-bold text-3xl`}
                >
                    {name[0]?.toUpperCase() ?? 'G'}
                </div>

                <h1 className="mt-8 text-5xl font-bold tracking-tight text-ink">{name}</h1>

                <p className="mt-2 text-lg text-muted">
                    {tripCount > 0 && (
                        <span>{tripCount} trip{tripCount === 1 ? '' : 's'}{joined && ' • '}</span>
                    )}
                    {joined && <span>Joined {joined}</span>}
                </p>

                <section className="mt-10">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
                        Verified info
                    </h2>

                    <div className="mt-4 space-y-3 max-w-sm">
                        <VerifiedRow
                            label="Approved to drive"
                            verified={Boolean(profile.identity_verified)}
                            action={<VerifyIdLink />}
                        />
                        <VerifiedRow
                            label="Email address"
                            verified={hasEmail}
                            action={<EditProfileLink label="Add email" />}
                        />
                        <VerifiedRow
                            label="Phone number"
                            verified={hasPhone}
                            action={<EditProfileLink label="Add phone number" />}
                        />
                    </div>

                    {!allVerified && (
                        <p className="mt-4 max-w-sm text-sm text-muted">
                            Build trust by verifying your contact information.
                        </p>
                    )}
                </section>
            </div>

            {/* RIGHT COLUMN — edit action and reviews */}
            <div>
                <div className="flex justify-end">
                    <Link
                        to="/profile/edit"
                        className="inline-block px-5 py-2.5 bg-brand hover:bg-pine-800 text-on-brand font-bold rounded-xl text-sm transition-colors"
                    >
                        Edit profile
                    </Link>
                </div>

                {/* Ratings and reviews aren't built yet. This is the layout with
                    nothing behind it — no query, no data. When reviews land,
                    the empty state below becomes the zero-reviews branch. */}
                <section className="mt-16">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
                        Reviews
                    </h2>

                    <div className="mt-4 flex items-start gap-4">
                        <div
                            className={`w-14 h-14 shrink-0 rounded-full ${avatarBg} flex items-center justify-center text-ink-400 font-bold text-lg`}
                        >
                            {name[0]?.toUpperCase() ?? 'G'}
                        </div>
                        <div>
                            <div className="flex gap-0.5">
                                {Array.from({ length: 5 }, (_, i) => (
                                    <Star key={i} size={16} className="text-line fill-line" />
                                ))}
                            </div>
                            <p className="mt-1 font-bold text-ink">No reviews yet</p>
                            <p className="text-muted">
                                {tripCount > 0
                                    ? `${tripCount} trip${tripCount === 1 ? '' : 's'} completed`
                                    : `${firstName} hasn't made a review yet.`}
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    )
}

// One VERIFIED INFO line. Verified shows a check; unverified shows the action
// that fixes it. The labelled cross covers a row with no action.
function VerifiedRow({
    label,
    verified,
    action,
}: {
    label: string
    verified: boolean
    action: ReactNode
}) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-ink">{label}</span>
            {verified ? (
                <Check size={18} className="text-pine-500 shrink-0" />
            ) : action ? (
                action
            ) : (
                <span className="flex items-center gap-1.5 text-sm text-muted shrink-0">
                    Not verified
                    <X size={18} className="text-red-800" />
                </span>
            )}
        </div>
    )
}

function EditProfileLink({ label }: { label: string }) {
    return (
        <Link
            to="/profile/edit"
            className="text-sm font-semibold text-pine-500 hover:underline shrink-0"
        >
            {label}
        </Link>
    )
}

// Starts the Stripe Identity scan and comes back to /profile, where
// useIdentityReturn picks the result up.
function VerifyIdLink() {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleClick = async () => {
        setLoading(true)
        setError(null)
        try {
            const returnUrl = `${window.location.origin}/profile?${VERIFICATION_RETURN_PARAM}=true`
            await startIdentityVerification(returnUrl)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to start verification')
            setLoading(false)
        }
    }

    return (
        <span className="text-right shrink-0">
            <button
                onClick={handleClick}
                disabled={loading}
                className="text-sm font-semibold text-pine-500 hover:underline disabled:opacity-50 cursor-pointer"
            >
                {loading ? 'Loading...' : 'Verify ID'}
            </button>
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        </span>
    )
}
