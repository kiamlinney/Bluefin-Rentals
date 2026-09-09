import { Link } from "@tanstack/react-router";
import { BUSINESS, OPENING_HOURS, to12Hour } from "@/lib/business.ts";
import { POLICY_PAGES } from "@/lib/policies.ts";

// Every public page links to every other one from here, which is how crawlers
// reach pages the navbar doesn't list (FAQ) and how visitors find the hours.
const Footer = () => {
    const year = new Date().getFullYear();

    return (
        <footer className="border-t-[0.5px] border-gray-400 mt-20">
            <div className="max-w-6xl mx-auto px-6 py-12 grid gap-10 md:grid-cols-4">
                <div className="md:col-span-2">
                    <p className="text-2xl text-gradient2">
                        <span className="font-bold text-white">Bluefin </span>Rentals
                    </p>
                    <p className="text-gray-300 text-sm mt-3 max-w-sm leading-relaxed">
                        Locally owned car rental serving {BUSINESS.areaServed}. Pick up in Saint
                        Paul, at MSP, or have the car delivered.
                    </p>
                    <p className="text-gray-300 text-sm mt-4">
                        {BUSINESS.city}, {BUSINESS.region} {BUSINESS.postalCode}
                    </p>
                </div>

                <div>
                    <h2 className="text-sm font-semibold text-white mb-3">Explore</h2>
                    <ul className="space-y-2 text-sm text-gray-300">
                        <li><Link to="/fleet" className="hover:text-white">Our fleet</Link></li>
                        <li><Link to="/faq" className="hover:text-white">FAQ</Link></li>
                        <li><Link to="/about" className="hover:text-white">About us</Link></li>
                        <li><Link to="/contact" className="hover:text-white">Contact</Link></li>
                    </ul>
                </div>

                <div>
                    <h2 className="text-sm font-semibold text-white mb-3">Hours</h2>
                    <ul className="space-y-2 text-sm text-gray-300">
                        {OPENING_HOURS.map(({ days, opens, closes }) => (
                            <li key={days.join()}>
                                <span className="block">{summarise(days)}</span>
                                <span className="text-gray-400">
                                    {to12Hour(opens)} – {to12Hour(closes)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <div className="border-t-[0.5px] border-gray-400">
                <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-gray-400">
                    <span>© {year} {BUSINESS.legalName}. All rights reserved.</span>
                    {/* In the bottom bar rather than a fifth column: the grid
                        above is full, and this is where legal links are looked
                        for anyway. */}
                    <ul className="flex flex-wrap gap-x-5 gap-y-2">
                        {POLICY_PAGES.map(({ path, label }) => (
                            <li key={path}>
                                <Link to={path} className="hover:text-white">{label}</Link>
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