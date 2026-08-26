import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { getUserProfile, getUserTripHistory } from '@/lib/db.ts'
import { UserProfile } from '@/components/UserProfile.tsx'
import type { UserProfileView, UserTripSummary } from '@/types.ts'

// The admin's view of a renter, reached from the avatar or name on a
// reservation. The /admin layout route has already established the viewer is an
// admin; both server functions below re-check that themselves, since either can
// be called directly rather than through this loader.
export const Route = createFileRoute('/admin/user/$userId')({
    loader: async ({ params }) => {
        const [{ profile }, trips] = await Promise.all([
            getUserProfile({ data: params.userId }),
            getUserTripHistory({ data: params.userId }),
        ])
        return { profile: profile as UserProfileView, trips: trips as UserTripSummary[] }
    },
    component: AdminUserProfilePage,
})

function AdminUserProfilePage() {
    const { profile, trips } = Route.useLoaderData()

    return (
        <div className="min-h-screen py-16 px-4 md:px-8">
            <div className="max-w-5xl mx-auto">
                <Link
                    to="/admin/trips/booked"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline"
                >
                    <ArrowLeft size={16} />
                    Trips
                </Link>

                <div className="mt-8">
                    <UserProfile profile={profile} viewer="admin" trips={trips} />
                </div>
            </div>
        </div>
    )
}