import { LoginOrSignUp } from "@/components/LoginOrSignUp";
import { getUser } from "@/lib/auth";
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";

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
    // The router's href is path + search ("/checkout/11?startDate=…"), never
    // the absolute URL. window.location.href used to be passed here, and
    // SignUpForm only follows redirects starting with "/", so signing up
    // mid-checkout dropped the customer on /fleet and lost their trip. It's
    // also available during SSR, where window isn't.
    const current = useLocation({ select: (location) => location.href });
    // The car being checked out, and the trip's dates, so "Back to the car"
    // can link straight to it. A real link rather than history.back(), which
    // did nothing in a fresh tab and left the site for anyone arriving from
    // elsewhere. Primitives, not one object, so each select stays stable.
    const checkoutCarId = useLocation({
        select: (location) => location.pathname.match(/^\/checkout\/([^/]+)/)?.[1] ?? null,
    });
    const tripStart = useLocation({
        select: (location) => (location.search as { startDate?: string }).startDate,
    });
    const tripEnd = useLocation({
        select: (location) => (location.search as { endDate?: string }).endDate,
    });

    if (!isLoggedIn) {
        // Checkout is a bare shell (no navbar), and the car page lets signed-out
        // visitors press Continue, so this is where they land. Without a line
        // of context a lone sign-up form reads as "something went wrong".
        if (checkoutCarId) {
            return (
                <div>
                    <div className="max-w-xl mx-auto px-12 pt-12 text-center">
                        <h1 className="text-2xl font-semibold">Almost there</h1>
                        <p className="mt-2 text-muted">
                            Create an account or log in to finish booking. Your trip details are saved.
                        </p>
                        {/* The bare id is enough: the car page 301s it to the
                            canonical slug. start/end are the car page's names
                            for checkout's startDate/endDate, so the dates come
                            back prefilled; the car page validates them itself. */}
                        <Link
                            to="/fleet/$carSlug"
                            params={{ carSlug: checkoutCarId }}
                            search={{ start: tripStart, end: tripEnd }}
                            className="inline-block mt-3 text-sm underline text-muted hover:text-ink"
                        >
                            Back to the car
                        </Link>
                    </div>
                    {/* The forms carry their own mt-12/p-12 for standing
                        alone on /login; under this heading that's a gap. */}
                    <div className="[&>div]:mt-0 [&>div]:pt-6">
                        <LoginOrSignUp redirect={current} />
                    </div>
                </div>
            );
        }
        return <LoginOrSignUp redirect={current} />;
    }

    return <Outlet />;
}