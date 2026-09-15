import { createFileRoute, useRouter } from '@tanstack/react-router'
import { getUserProfile } from '@/lib/db.ts'
import { getUserWithProfile } from '@/lib/auth.ts'
import { UserProfile } from '@/components/UserProfile.tsx'
import { useIdentityReturn } from '@/lib/identity.ts'
import type { UserProfileView } from '@/types.ts'

// The signed-in user's own profile. Same layout as the admin view, minus the
// contact and trip-history blocks, plus the edit button and the verification
// actions. getUserProfile only ever gets this viewer's own id here, and rejects
// anything else for a non-admin caller anyway.
export const Route = createFileRoute('/_authed/profile')({
    loader: async () => {
        const viewer = await getUserWithProfile()
        // _authed has already established there is a session; getUserWithProfile
        // only returns null when there isn't one.
        if (!viewer) throw new Error('Not authenticated')

        const { profile } = await getUserProfile({ data: viewer.id })
        return { profile: profile as UserProfileView }
    },
    component: ProfilePage,
})

function ProfilePage() {
    const { profile } = Route.useLoaderData()
    const router = useRouter()

    // Only does anything when the URL carries ?verificationReturn=true, i.e. the
    // user just came back from the Stripe Identity scan. Invalidating re-runs the
    // loader, so "Approved to drive" flips to a checkmark without a reload.
    const { polling, error } = useIdentityReturn(() => {
        void router.invalidate()
    })

    return (
        <div className="min-h-screen py-24 px-4 md:px-8">
            <div className="max-w-5xl mx-auto space-y-6">
                {polling && (
                    <div className="bg-surface border border-line rounded-2xl p-5 text-center">
                        <p className="font-semibold">Confirming your verification...</p>
                        <p className="text-muted text-sm mt-1">This usually takes just a few seconds.</p>
                    </div>
                )}

                {error && (
                    <div className="bg-red-100 border border-red-800 rounded-2xl p-5">
                        <p className="text-red-800 text-sm">{error}</p>
                    </div>
                )}

                <div className="bg-surface border border-line rounded-2xl p-8 md:p-10">
                    <UserProfile profile={profile} viewer="self" />
                </div>
            </div>
        </div>
    )
}