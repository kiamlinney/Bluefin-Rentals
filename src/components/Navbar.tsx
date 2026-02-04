import { Link } from "@tanstack/react-router";

const Navbar = () => {
    const navLinks = [
        { name: "fleet", to: "/fleet" },
        { name: "about", to: "/about" },
        { name: "contact", to: "/contact" },
    ];

    return (
        <nav className="flex items-center justify-between px-8 py-4 bg-gray-300 border-b-3 sticky top-0 z-50 shadow-sm">
            {/* Logo Section */}
            <Link to="/" className="hover:opacity-80 transition-opacity">
                <p className="text-2xl text-gradient2">
                    <span className="font-bold">Bluefin </span>Rentals
                </p>
            </Link>

            {/* Links Section */}
            <div className="flex items-center gap-9">
                {navLinks.map((link) => (
                    <Link
                        key={link.to}
                        to={link.to}
                        className="text-gray-900 hover:text-gray-800 font-medium transition-colors"
                        //text-sm uppercase tracking-widest text-gray-900 hover:text-black font-semibold transition-colors
                        activeProps={{ className: "border-b-2 border-gray-800" }}
                    >
                        {link.name}
                    </Link>
                ))}

                <Link
                    to="/fleet"
                    className="primary-button bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-800"
                >
                    Book Now
                </Link>
            </div>
        </nav>
    );
};

export default Navbar;