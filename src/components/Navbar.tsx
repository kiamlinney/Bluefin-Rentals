import { Link } from "@tanstack/react-router";

const Navbar = ({ user }: { user: any | null }) => {
    const navLinks = [
        { name: "fleet", to: "/fleet" },
        { name: "about", to: "/about" },
        { name: "contact", to: "/contact" },
    ];

    return (
        <nav className="top-0 w-full z-50 flex items-center justify-between px-8 py-4 bg-gray-300 border-b-3 sticky shadow-sm">
            {/* Logo Section */}
            <Link to="/" className="hover:opacity-60 transition-opacity">
                <p className="text-4xl text-gradient2">
                    <span className="font-bold">Bluefin </span>Rentals
                </p>
            </Link>

            {/* Links Section */}
            <div className="flex items-center gap-9">
                {navLinks.map((link) => (
                    <Link
                        key={link.to}
                        to={link.to}
                        className="text-gray-900 text-2xl hover:scale-105 font-medium transition-colors"
                        //text-sm uppercase tracking-widest text-gray-900 hover:text-black font-semibold transition-colors
                        activeProps={{ className: "border-b-2 border-gray-800" }}
                    >
                        {link.name}
                    </Link>
                ))}

                {user?.id ? (
                    <div className="flex items-center gap-4">
                        <span className="text-gray-700 text-sm hidden md:block">
                            {user.email}
                        </span>
                        <Link to="/fleet" className="secondary-button text-xl w-fit font-semibold">
                            Profile
                        </Link>
                    </div>
                ) : (
                    <Link to="/fleet" className="secondary-button text-xl w-fit font-semibold">
                        Login
                    </Link>
                )}
            </div>
        </nav>
    );
};

export default Navbar;