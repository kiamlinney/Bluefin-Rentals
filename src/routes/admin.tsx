import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { getUserWithProfile } from '@/lib/auth.ts'
import { AdminSidebar } from "@/components/admin/AdminSidebar.tsx";

export const Route = createFileRoute('/admin')({
    beforeLoad: async ({ location }) => {
        const user = await getUserWithProfile()

        if (!user) {
            throw redirect({ to: '/login', search: { redirect: '/admin/trips/booked' } })
        }
        if (!user.is_admin) {
            throw redirect({ to: '/403' })
        }

        else if(location.pathname === '/admin/trips') {
            throw redirect({ to: '/admin/trips/booked' })
        }
        else if(location.pathname === '/admin/business') {
            throw redirect({ to: '/admin/business/ratings-reviews' })
        }
        return { user }
    },
    component: AdminLayout,
})

function AdminLayout() {
    const { user } = Route.useRouteContext();
    return (
        <div className="flex h-screen w-screen overflow-hidden admin-shell">
            <AdminSidebar user={user}/>

            <main className="flex-1 h-full overflow-y-auto">
                <Outlet />
            </main>
        </div>
    )
}