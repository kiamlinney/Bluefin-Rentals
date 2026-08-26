import { Link } from "@tanstack/react-router";
import { Car } from "../types";
import { carSlug } from "../lib/slug";

// Dates come in as a prop rather than via useSearch so the card stays usable
// outside the fleet route, and so the hand-off is visible at the call site.
type CarCardSearch = { start?: string; end?: string }

const CarCard = ({ car, search } : { car : Car; search?: CarCardSearch }) => {
    return (
        <Link
            to="/fleet/$carSlug"
            params={{ carSlug: carSlug(car) }}
            // Carries the search bar's dates into the booking widget so the
            // customer doesn't re-pick dates they already picked. TanStack drops
            // undefined values, so a dateless fleet page still links to /fleet/3.
            search={{ start: search?.start, end: search?.end }}
            className="group flex flex-col bg-[#152110] border-[0.5px] border-gray-400 rounded-2xl shadow-white/10 overflow-hidden hover:shadow-lg transition-shadow"
        >
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#152110]">
                <img src={car.image_url ?? undefined} alt={car.make} className="w-full h-full object-cover" />
            </div>

            <div className="p-4">
                <h3 className="text-xl">{car.make} {car.model} {car.trim} {car.year}</h3>
                <p className="text-gray-400">${car.price_per_day} / day</p>
            </div>
        </Link>
    );
};

export default CarCard;