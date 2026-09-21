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
        // Column on phones (menu bar on top), row from md up (sidebar on the left).
        // h-dvh rather than h-screen so iOS Safari's address bar doesn't cover the bottom.
        <div className="flex flex-col md:flex-row h-dvh w-full overflow-hidden admin-shell">
            <AdminSidebar user={user}/>

            <main className="flex-1 min-h-0 overflow-y-auto">
                <Outlet />
            </main>
        </div>
    )
}