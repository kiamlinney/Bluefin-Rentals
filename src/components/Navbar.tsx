import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { logoutUser } from "@/lib/auth.ts";

const NAV_HEIGHT = 56; // h-14

const Navbar = ({ user }: { user: any | null }) => {
    const [isOpen, setIsOpen] = useState(false);
    const router = useRouter();
    const { pathname } = useLocation();

    // On a page with a full-bleed hero, the navbar sits transparent with white
    // text over it, and turns solid once the page's content scrolls up to meet
    // it.
    // Every other page gets the solid navbar from the start.
    //
    // The initial value is derived from the pathname rather than the DOM so the
    // server renders the right variant — otherwise the homepage would flash a
    // solid bar over the video until hydration.
    const hasHero = pathname === "/";
    // Derived rather than stored, so the navbar goes transparent in the same
    // render the URL changes. 
    const [pastHero, setPastHero] = useState(false);
    const overHero = hasHero && !pastHero;

    useEffect(() => {
        if (!hasHero) {
            // Reset on the way out, so the next visit starts transparent.
            setPastHero(false);
            return;
        }
        const selector = "[data-nav-solid-from]";
        let frame = 0;
        const update = () => {
            frame = 0;
            const trigger = document.querySelector(selector);
            if (!trigger) return;
            setPastHero(trigger.getBoundingClientRect().top <= NAV_HEIGHT);
        };
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };

        // On a client-side navigation this effect runs as soon as the URL
        // changes, before the homepage has rendered the element it measures.
        // Checking once then would find nothing, so wait for it to appear.
        let observer: MutationObserver | null = null;
        if (!document.querySelector(selector)) {
            observer = new MutationObserver(() => {
                if (!document.querySelector(selector)) return;
                observer?.disconnect();
                observer = null;
                update();
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        update();
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        return () => {
            observer?.disconnect();
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
        };
    }, [hasHero]);

    const navLinks = [
        { name: "fleet", to: "/fleet" },
        { name: "about", to: "/about" },
        { name: "contact", to: "/contact" },
    ];

    const handleLogout = async () => {
        try {
            await logoutUser();
            await router.invalidate();
            setIsOpen(false);
            router.navigate({ to: "/" });

        } catch (err) {
            console.error("Logout failed:", err);
        }
    }

    return (
        <nav
            className={`sticky top-0 h-14 w-full z-50 flex items-center justify-between px-8 border-b-[0.5px] transition-colors duration-300 ${
                overHero
                    ? "bg-transparent border-white/25 text-white"
                    : "bg-page/90 backdrop-blur-md border-line text-ink"
            }`}
        >
            {/* Logo Section */}
            <Link to="/" className="hover:opacity-60 transition-opacity">
                <p className="text-3xl">
                    <span className="font-bold">Bluefin </span>Rentals
                </p>
            </Link>

            {/* Links Section */}
            <div className="flex items-center gap-9">
                {navLinks.map((link) => (
                    <Link
                        key={link.to}
                        to={link.to}
                        className="text-xl hover:scale-105 font-medium transition-colors"
                        activeProps={{ className: "border-b-2 border-current" }}
                    >
                        {link.name}
                    </Link>
                ))}

                {/* Checking if user is logged in, if so, display their profile, if not, have sign up button */}
                {user?.id ? (
                    <div className="relative">
                        <button
                            onClick={() => setIsOpen(!isOpen)}
                            className="w-10 h-10 rounded-full bg-brand text-on-brand flex items-center justify-center font-bold hover:bg-pine-800 transition-colors cursor-pointer"
                        >
                            {user.email?.[0].toUpperCase()}
                        </button>

                        {/* Dropdown Menu */}
                        {isOpen && (
                            <div className="absolute top-full right-0 mt-2 w-48 bg-surface text-ink rounded-lg shadow-xl border border-line py-2 z-50 origin-top-right">
                                <div className="px-4 py-2 border-b border-line mb-1">
                                    <p className="text-xs text-muted">Signed in as</p>
                                    <p className="text-sm font-semibold truncate">{user.email}</p>
                                </div>


                                <Link
                                    to="/profile"
                                    onClick={() => setIsOpen(false)}
                                    className="block px-4 py-2 text-sm hover:bg-subtle cursor-pointer"
                                >
                                    View Profile
                                </Link>

                                {user?.is_admin ? (
                                    <Link
                                        to="/admin"
                                        onClick={() => setIsOpen(false)}
                                        className="block px-4 py-2 text-sm hover:bg-subtle cursor-pointer"
                                    >
                                        Admin Page
                                    </Link>
                                ) : (
                                    <Link
                                        to="/my-bookings"
                                        onClick={() => setIsOpen(false)}
                                        className="block px-4 py-2 text-sm hover:bg-subtle cursor-pointer"
                                    >
                                        My Bookings
                                    </Link>
                                )}

                                <button
                                    onClick={handleLogout}
                                    className="w-full text-left block px-4 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer"
                                >
                                    Log Out
                                </button>
                            </div>
                        )}

                        {/* Invisible overlay to close dropdown when clicking away */}
                        {isOpen && (
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setIsOpen(false)}
                            />
                        )}
                    </div>
                ) : (
                    <Link
                        to="/login"
                        className={`secondary-button w-fit font-semibold text-xs ${
                            overHero ? "bg-white text-ink border-white hover:bg-cream-100" : ""
                        }`}
                    >
                        Sign Up
                    </Link>
                )}
            </div>
        </nav>
    );
};

export default Navbar;