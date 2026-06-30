import { Car } from "src/types.ts";

export function CalendarCarCard({ car }: { car: Car }) {
    return (
        <div className="flex flex-row gap-4 items-center justify-center">
            <div className="w-full rounded-md md:w-12 h-8 flex-shrink-0">
                <img
                    src={`https://fmueikfpthimanfrituz.supabase.co/storage/v1/object/public/car%20gallery/car_${car.id}/main.PNG`}
                    alt={`${car.year} ${car.make} ${car.model}`}
                    className="w-12 h-8 object-cover rounded-sm flex-shrink-0"
                />
            </div>

            <div className="flex flex-col text-left">
                <p className="text-xs text-black mt-1">
                    {car.make} {car.model} {car.year}
                </p>

                <p className="text-xs text-gray-600">
                    {car.license_plate}
                </p>
            </div>

        </div>
    )
}