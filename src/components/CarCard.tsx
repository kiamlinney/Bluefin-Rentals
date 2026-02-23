import { Link } from "@tanstack/react-router";

// 1. Define the props (the car data)
const CarCard = ({ car }) => {
    return (
        <Link
            to="/fleet/$carId"
            params={{ carId: car.id.toString() }}
            className="group flex flex-col bg-white rounded-2xl shadow-sm border border-gray-800 overflow-hidden hover:shadow-lg transition-shadow"
        >
            {/* The rest of the HTML/Tailwind logic goes here */}
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-gray-200">
                <img src={car.image_url} alt={car.make} className="w-full h-full object-cover" />
            </div>

            <div className="p-4">
                <h3 className="text-xl font-bold">{car.make} {car.model} {car.year}</h3>
                <p className="text-gray-500">${car.price_per_day} / day</p>
            </div>
        </Link>
    );
};

export default CarCard;