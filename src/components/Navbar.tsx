import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {logoutUser} from "@/lib/auth.ts";

const Navbar = ({ user }: { user: any | null }) => {
    const [isOpen, setIsOpen] = useState(false);
    const router = useRouter();

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
        <nav className="top-0 w-full z-50 flex items-center justify-between px-8 py-4 bg-gray-300 border-b-3 sticky shadow-sm">
            {/* Logo Section */}
            <Link to="/" className="hover:opacity-60 transition-opacity">
                <p className="text-3xl text-gradient2">
                    <span className="font-bold">Bluefin </span>Rentals
                </p>
            </Link>

            {/* Links Section */}
            <div className="flex items-center gap-9">
                {navLinks.map((link) => (
                    <Link
                        key={link.to}
                        to={link.to}
                        className="text-gray-900 text-xl hover:scale-105 font-medium transition-colors"
                        activeProps={{ className: "border-b-2 border-gray-800" }}
                    >
                        {link.name}
                    </Link>
                ))}


                {user?.id ? (
                    <div className="relative">
                        <button
                            onClick={() => setIsOpen(!isOpen)}
                            className="w-10 h-10 rounded-full bg-gray-800 text-white flex items-center justify-center font-bold hover:bg-gray-700 transition-colors"
                        >
                            {user.email?.[0].toUpperCase()}
                        </button>

                        {/* Dropdown Menu */}
                        {isOpen && (
                            <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50 origin-top-right">
                                <div className="px-4 py-2 border-b border-gray-100 mb-1">
                                    <p className="text-xs text-gray-500">Signed in as</p>
                                    <p className="text-sm font-semibold truncate text-gray-900">{user.email}</p>
                                </div>

                                <Link
                                    to="/fleet"
                                    onClick={() => setIsOpen(false)}
                                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                >
                                    My Bookings
                                </Link>

                                <button
                                    onClick={handleLogout}
                                    className="w-full text-left block px-4 py-2 text-sm text-red-600 hover:bg-red-50"
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
                    <Link to="/login" className="secondary-button w-fit font-semibold">
                        Sign Up
                    </Link>
                )}
            </div>
        </nav>
    );
};

export default Navbar;