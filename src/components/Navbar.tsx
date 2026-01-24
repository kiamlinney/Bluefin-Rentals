import { Link } from "@tanstack/react-router";

const Navbar = () => {
    const navLinks = [
        { name: "fleet", to: "/fleet" },
        { name: "about", to: "/about" },
        { name: "contact", to: "/contact" },
    ];

    return (
        <nav className="flex items-center justify-between px-8 py-4 bg-white shadow-sm">
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
                        className="text-gray-600 hover:text-gray-800 font-medium transition-colors"
                        // activeProps style will apply when you are on that specific page
                        activeProps={{ className: "text-gray-600 font-bold" }}
                    >
                        {link.name}
                    </Link>
                ))}

                {/* Optional: Call to Action button stays separate or styled differently */}
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