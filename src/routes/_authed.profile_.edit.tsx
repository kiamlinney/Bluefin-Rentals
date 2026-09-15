import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { getProfile } from '@/lib/db.ts'
import { DriverInfoStep } from '@/components/checkout/DriverInfoStep.tsx'

// The trailing underscore on profile_ opts this route out of nesting under
// _authed.profile.tsx, so it renders as its own page. The URL is unaffected:
// /profile/edit.
//
// The form itself is DriverInfoStep — the same eight columns, the same
// validation, the same saveDriverInfo call that checkout uses. The address
// fields are here even though the profile page never shows them, because
// saveDriverInfo upserts the whole set and omitting them would blank the stored
// address.
export const Route = createFileRoute('/_authed/profile_/edit')({
    // getProfile is self-only by construction — there is no id to pass — which
    // is exactly the authorization this page wants.
    loader: async () => ({ profile: await getProfile() }),
    component: EditProfilePage,
})

function EditProfilePage() {
    const { profile } = Route.useLoaderData()
    const navigate = useNavigate()

    return (
        <div className="min-h-screen py-24 px-4 md:px-8">
            <div className="max-w-2xl mx-auto space-y-6">
                <Link
                    to="/profile"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                >
                    <ArrowLeft size={16} />
                    Back to profile
                </Link>

                <div className="bg-surface border border-line rounded-2xl p-8">
                    <DriverInfoStep
                        existingProfile={profile}
                        heading="Edit profile"
                        description="Used for your bookings and ID verification."
                        submitLabel="Save changes"
                        showIdVerificationNote={false}
                        onComplete={() => navigate({ to: '/profile' })}
                    />
                </div>
            </div>
        </div>
    )
}