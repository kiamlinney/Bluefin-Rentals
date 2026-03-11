import { LoginOrSignUp } from "@/components/LoginOrSignUp";
import { getUser } from "@/lib/auth";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed")({
    component: RouteComponent,
    beforeLoad: async () => {
        try {
            const user  = await getUser();
            return {
                isLoggedIn: !!user?.email,
                user
            };
        } catch (_) {
            return { isLoggedIn: false, user: null };
        }
    },
});

function RouteComponent() {
    const { isLoggedIn } = Route.useRouteContext();
    if (!isLoggedIn) return <LoginOrSignUp />;

    return <Outlet />;
}