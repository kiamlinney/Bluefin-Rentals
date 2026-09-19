import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { logoutUser } from "@/lib/auth.ts";
import { cn } from "@/lib/utils.ts";
import { NAV_HEIGHT } from "@/lib/layout.ts";

const navLinks = [
    { name: "fleet", to: "/fleet" },
    { name: "reviews", to: "/reviews" },
    { name: "about", to: "/about" },
    { name: "contact", to: "/contact" },
] as const;

const Navbar = ({ user }: { user: any | null }) => {
    // Two separate menus: the account dropdown (desktop) and the hamburger
    // panel (phones). Only one is ever reachable at a time, since each is
    // hidden at the other's screen size.
    const [accountOpen, setAccountOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const navRef = useRef<HTMLElement>(null);
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
    // render the URL changes. An open hamburger panel also forces it solid:
    // the panel has a solid background, and a see-through bar with white text
    // above it would look detached.
    const [pastHero, setPastHero] = useState(false);
    const overHero = hasHero && !pastHero && !menuOpen;

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

    // Close both menus whenever the page changes. Clicking a link closes them
    // too (see onClick below), but this also covers the browser's back and
    // forward buttons, which no onClick sees.
    useEffect(() => {
        setMenuOpen(false);
        setAccountOpen(false);
    }, [pathname]);

    // While a menu is open: a click anywhere outside the navbar, or Escape,
    // closes it.
    useEffect(() => {
        if (!menuOpen && !accountOpen) return;
        const close = () => {
            setMenuOpen(false);
            setAccountOpen(false);
        };
        const onPointerDown = (e: PointerEvent) => {
            if (!navRef.current?.contains(e.target as Node)) close();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [menuOpen, accountOpen]);

    // Shared by the desktop dropdown and the phone panel, so the two can't
    // offer different options.
    const accountLinks = user?.id
        ? [
              { label: "View Profile", to: "/profile" },
              user.is_admin
                  ? { label: "Admin Page", to: "/admin" }
                  : { label: "My Bookings", to: "/my-bookings" },
          ]
        : [];

    const closeMenus = () => {
        setMenuOpen(false);
        setAccountOpen(false);
    };

    const handleLogout = async () => {
        try {
            await logoutUser();
            await router.invalidate();
            closeMenus();
            router.navigate({ to: "/" });

        } catch (err) {
            console.error("Logout failed:", err);
        }
    }

    return (
        <nav
            ref={navRef}
            // px-6 on phones lines the logo up with the page content below,
            // which also uses px-6. px-8 from md.
            className={cn(
                "sticky top-0 h-14 w-full z-50 flex items-center justify-between px-6 md:px-8 border-b-[0.5px] transition-colors duration-300",
                overHero
                    ? "bg-transparent border-white/25 text-white"
                    : "bg-page/90 backdrop-blur-md border-line text-ink",
            )}
        >
            {/* Logo Section. One size smaller on phones so the logo and the
                menu button fit side by side. */}
            <Link to="/" className="hover:opacity-60 transition-opacity">
                <p className="text-2xl md:text-3xl">
                    <span className="font-bold">Bluefin </span>Rentals
                </p>
            </Link>

            {/* Desktop links. `hidden md:flex`: not shown below md, where the
                hamburger takes over. These four items are what made the bar
                494px wide on a 390px phone, and mobile browsers respond to that
                by zooming the whole page out. */}
            <div className="hidden md:flex items-center gap-9">
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
                            type="button"
                            onClick={() => setAccountOpen(!accountOpen)}
                            // The button shows only a letter, so the label is
                            // what screen readers announce. aria-expanded tells
                            // them whether the menu is open.
                            aria-label="Account menu"
                            aria-expanded={accountOpen}
                            className="w-10 h-10 rounded-full bg-brand text-on-brand flex items-center justify-center font-bold hover:bg-pine-800 transition-colors cursor-pointer"
                        >
                            {user.email?.[0].toUpperCase()}
                        </button>

                        {/* Dropdown Menu */}
                        {accountOpen && (
                            <div className="absolute top-full right-0 mt-2 w-48 bg-surface text-ink rounded-lg shadow-xl border border-line py-2 z-50 origin-top-right">
                                <div className="px-4 py-2 border-b border-line mb-1">
                                    <p className="text-xs text-muted">Signed in as</p>
                                    <p className="text-sm font-semibold truncate">{user.email}</p>
                                </div>

                                {accountLinks.map((link) => (
                                    <Link
                                        key={link.to}
                                        to={link.to}
                                        onClick={closeMenus}
                                        className="block px-4 py-2 text-sm hover:bg-subtle cursor-pointer"
                                    >
                                        {link.label}
                                    </Link>
                                ))}

                                <button
                                    type="button"
                                    onClick={handleLogout}
                                    className="w-full text-left block px-4 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer"
                                >
                                    Log Out
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <Link
                        to="/login"
                        className={cn(
                            "secondary-button m-0 w-fit font-semibold text-xs",
                            overHero && "bg-white text-ink border-white hover:bg-cream-100",
                        )}
                    >
                        Sign Up
                    </Link>
                )}
            </div>

            {/* Hamburger, phones only. A real <button>, so it's reachable with
                Tab and Enter. aria-controls points screen readers at the panel it
                opens. -mr-2 cancels the button's own padding, so the icon lines
                up with the bar's right edge while the tap target stays 40px. */}
            <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                aria-controls="mobile-menu"
                className="md:hidden -mr-2 p-2 cursor-pointer"
            >
                {menuOpen ? <X className="size-6" /> : <Menu className="size-6" />}
            </button>

            {/* The phone panel drops down from the bottom of the bar
                (`absolute top-full`) and spans its full width. It's positioned
                against the nav, which as a sticky element counts as positioned,
                so the panel stays attached to the bar while the page scrolls.
                md:hidden keeps it from lingering if the window is widened with
                the panel open. */}
            {menuOpen && (
                <div
                    id="mobile-menu"
                    className="md:hidden absolute inset-x-0 top-full bg-page text-ink border-b border-line shadow-lg"
                >
                    <ul className="px-4 py-2">
                        {navLinks.map((link) => (
                            <li key={link.to}>
                                {/* block + py-3 makes the whole row tappable,
                                    not just the word. */}
                                <Link
                                    to={link.to}
                                    onClick={closeMenus}
                                    className="block py-3 text-xl font-medium"
                                    activeProps={{ className: "underline underline-offset-4" }}
                                >
                                    {link.name}
                                </Link>
                            </li>
                        ))}
                    </ul>

                    <div className="border-t border-line px-4 py-4">
                        {user?.id ? (
                            <>
                                <p className="text-xs text-muted">Signed in as</p>
                                <p className="text-sm font-semibold truncate mb-2">{user.email}</p>
                                {accountLinks.map((link) => (
                                    <Link
                                        key={link.to}
                                        to={link.to}
                                        onClick={closeMenus}
                                        className="block py-2"
                                    >
                                        {link.label}
                                    </Link>
                                ))}
                                <button
                                    type="button"
                                    onClick={handleLogout}
                                    className="block py-2 text-red-600 cursor-pointer"
                                >
                                    Log Out
                                </button>
                            </>
                        ) : (
                            // Full width on a phone
                            <Link
                                to="/login"
                                onClick={closeMenus}
                                className="secondary-button m-0 block w-full font-semibold"
                            >
                                Sign Up
                            </Link>
                        )}
                    </div>
                </div>
            )}
        </nav>
    );
};

export default Navbar;