import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Star, X } from 'lucide-react'
import { formatBusinessDate, formatDateKey } from '@/lib/dates.ts'
import { displayName, formatPhone } from '@/lib/profile.ts'
import { startIdentityVerification, VERIFICATION_RETURN_PARAM } from '@/lib/identity.ts'
import type { UserProfileView, UserTripSummary } from '@/types.ts'

// One profile layout, two audiences:
//
//   viewer="admin"  →  /admin/user/$userId, any user. Read-only, and carries the
//                      two blocks an admin needs that a renter shouldn't see on
//                      their own page: contact details and trip history.
//   viewer="self"   →  /profile, the signed-in user's own. No contact block (the
//                      values are already on the page as verification rows), no
//                      trip history (/my-bookings is that), but the unverified
//                      rows become actions and there's an edit button.
//
// The two blocks are gated on the prop rather than on a runtime permission check
// because each route already has exactly one audience — /admin/* is behind the
// admin gate, /profile only ever loads the caller's own row. Authorization lives
// in getUserProfile / getUserTripHistory, not here.
export function UserProfile({
    profile,
    viewer,
    trips,
}: {
    profile: UserProfileView
    viewer: 'admin' | 'self'
    trips?: UserTripSummary[]
}) {
    const isSelf = viewer === 'self'
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
                            action={isSelf ? <VerifyIdLink /> : null}
                        />
                        <VerifiedRow
                            label="Email address"
                            verified={hasEmail}
                            action={isSelf ? <EditProfileLink label="Add email" /> : null}
                        />
                        <VerifiedRow
                            label="Phone number"
                            verified={hasPhone}
                            action={isSelf ? <EditProfileLink label="Add phone number" /> : null}
                        />
                    </div>

                    {isSelf && !allVerified && (
                        <p className="mt-4 max-w-sm text-sm text-muted">
                            Build trust by verifying your contact information.
                        </p>
                    )}
                </section>

                {!isSelf && (
                    <section className="mt-10">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
                            Contact
                        </h2>
                        <dl className="mt-4 space-y-3 max-w-sm">
                            <ContactRow label="Email" value={profile.email} />
                            <ContactRow label="Phone" value={formatPhone(profile.phone)} />
                            <ContactRow
                                label="Date of birth"
                                // date_of_birth is a bare `date` column with no
                                // time or zone, so it goes through formatDateKey
                                // rather than the timezone-pinned formatters.
                                value={
                                    profile.date_of_birth
                                        ? formatDateKey(profile.date_of_birth, {
                                              month: 'short',
                                              day: 'numeric',
                                              year: 'numeric',
                                          })
                                        : null
                                }
                            />
                        </dl>
                    </section>
                )}

                {!isSelf && <TripHistory trips={trips ?? []} />}
            </div>

            {/* RIGHT COLUMN — edit action and reviews */}
            <div>
                {isSelf && (
                    <div className="flex justify-end">
                        <Link
                            to="/profile/edit"
                            className="inline-block px-5 py-2.5 bg-brand hover:bg-pine-800 text-on-brand font-bold rounded-xl text-sm transition-colors"
                        >
                            Edit profile
                        </Link>
                    </div>
                )}

                {/* Ratings and reviews aren't built yet. This is the layout with
                    nothing behind it — no query, no data. When reviews land,
                    the empty state below becomes the zero-reviews branch. */}
                <section className={isSelf ? 'mt-16' : ''}>
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

// One VERIFIED INFO line. Verified shows a check; unverified shows either an
// action (guest, who can do something about it) or a labelled cross (admin, who
// can't). The cross is labelled on purpose — the reservation page's version
// renders a bare red X with no text, which reads as a rendering bug.
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

function ContactRow({ label, value }: { label: string; value: string | null }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <dt className="text-ink">{label}</dt>
            <dd className={value ? 'text-ink font-medium' : 'text-muted'}>
                {value ?? 'Not provided'}
            </dd>
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

function TripHistory({ trips }: { trips: UserTripSummary[] }) {
    return (
        <section className="mt-10">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
                Trip history
            </h2>

            {trips.length === 0 ? (
                <p className="mt-4 text-muted">No trips yet</p>
            ) : (
                <ul className="mt-4 space-y-2 max-w-md">
                    {trips.map(trip => {
                        const car = trip.cars
                        const isCanceled = trip.status === 'canceled'
                        return (
                            <li key={trip.id}>
                                <Link
                                    to="/admin/reservation/$bookingId"
                                    params={{ bookingId: trip.id }}
                                    className="flex items-center justify-between gap-4 border border-line rounded-lg px-4 py-3 hover:border-ink-400 hover:shadow-sm transition-all"
                                >
                                    <div>
                                        <p className="font-semibold text-ink">
                                            {car.year} {car.make} {car.model}
                                        </p>
                                        <p
                                            className={`text-sm text-muted ${isCanceled ? 'line-through' : ''}`}
                                        >
                                            {formatBusinessDate(trip.start_time)} –{' '}
                                            {formatBusinessDate(trip.end_time)}
                                        </p>
                                    </div>
                                    <span
                                        className={`text-xs px-2 py-0.5 rounded-sm shrink-0 ${STATUS_BADGE[trip.status ?? ''] ?? 'bg-gray-100 text-gray-600'}`}
                                    >
                                        {trip.status}
                                    </span>
                                </Link>
                            </li>
                        )
                    })}
                </ul>
            )}
        </section>
    )
}

// Same palette as the admin trip cards, so a status reads the same colour
// wherever it appears in the admin shell.
const STATUS_BADGE: Record<string, string> = {
    confirmed: 'bg-green-600/30 text-green-700',
    completed: 'bg-gray-700/20 text-gray-700',
    canceled: 'bg-red-100 text-red-700',
    pending: 'bg-amber-300/60 text-black',
    // Filtered out of this list by getUserBookings, but the map is keyed by a
    // string and a missing entry renders an unstyled badge — so it's here for
    // whatever reaches it by another route.
    expired: 'bg-gray-200 text-gray-600',
}