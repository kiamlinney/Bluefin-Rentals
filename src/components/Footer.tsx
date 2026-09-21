import { Link } from "@tanstack/react-router";
import { BUSINESS, OPENING_HOURS, to12Hour } from "@/lib/business.ts";
import { POLICY_PAGES } from "@/lib/policies.ts";

// Every public page links to every other one from here, which is how crawlers
// reach pages the navbar doesn't list (FAQ) and how visitors find the hours.
const Footer = () => {
    const year = new Date().getFullYear();

    return (
        // print:hidden for the same reason the navbar is — see Navbar.tsx.
        <footer className="border-t border-line mt-20 print:hidden">
            <div className="max-w-6xl mx-auto px-6 py-12 grid gap-10 md:grid-cols-4">
                <div className="md:col-span-2">
                    <p className="text-2xl">
                        <span className="font-bold">Bluefin </span>Rentals
                    </p>
                    <p className="text-muted text-sm mt-3 max-w-md leading-relaxed">
                        Locally owned car rental serving {BUSINESS.areaServed}.
                    </p>
                    <p className="text-muted text-sm mt-4">
                        {BUSINESS.city}, {BUSINESS.region} {BUSINESS.postalCode}
                    </p>
                </div>

                <div>
                    <h2 className="text-sm font-semibold mb-3">Explore</h2>
                    <ul className="space-y-2 text-sm text-muted">
                        <li><Link to="/fleet" className="hover:text-ink">Our fleet</Link></li>
                        <li><Link to="/reviews" className="hover:text-ink">Reviews</Link></li>
                        <li><Link to="/faq" className="hover:text-ink">FAQ</Link></li>
                        <li><Link to="/about" className="hover:text-ink">About us</Link></li>
                        <li><Link to="/contact" className="hover:text-ink">Contact</Link></li>
                    </ul>
                </div>

                <div>
                    <h2 className="text-sm font-semibold mb-3">Hours</h2>
                    <ul className="space-y-2 text-sm text-muted">
                        {OPENING_HOURS.map(({ days, opens, closes }) => (
                            <li key={days.join()}>
                                <span className="block text-ink">{summarise(days)}</span>
                                <span>
                                    {to12Hour(opens)} – {to12Hour(closes)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <div className="border-t border-line">
                <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted">
                    <span>© {year} {BUSINESS.legalName}. All rights reserved.</span>
                    {/* In the bottom bar rather than a fifth column: the grid
                        above is full, and this is where legal links are looked
                        for anyway. */}
                    <ul className="flex flex-wrap gap-x-5 gap-y-2">
                        {POLICY_PAGES.map(({ path, label }) => (
                            <li key={path}>
                                <Link to={path} className="hover:text-ink">{label}</Link>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </footer>
    );
};

/** ["Monday","Tuesday","Saturday","Sunday"] -> "Mon, Tue, Sat, Sun" */
function summarise(days: readonly string[]): string {
    return days.map((d) => d.slice(0, 3)).join(", ");
}

export default Footer;