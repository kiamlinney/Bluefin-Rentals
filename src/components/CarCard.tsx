import { Link } from "@tanstack/react-router";
import { Car } from "../types";

const CarCard = ({ car } : { car : Car}) => {
    return (
        <Link
            to="/fleet/$carId"
            params={{ carId: car.id.toString() }}
            className="group flex flex-col bg-[#152110] border-[0.5px] border-gray-400 rounded-2xl shadow-white/10 overflow-hidden hover:shadow-lg transition-shadow"
        >
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#152110]">
                <img src={car.image_url} alt={car.make} className="w-full h-full object-cover" />
            </div>

            <div className="p-4">
                <h3 className="text-xl">{car.make} {car.model} {car.year}</h3>
                <p className="text-gray-400">${car.price_per_day} / day</p>
            </div>
        </Link>
    );
};

export default CarCard;