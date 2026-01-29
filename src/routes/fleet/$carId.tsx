import {createFileRoute} from '@tanstack/react-router'
import { supabase } from '../../lib/supabase'

export const Route = createFileRoute('/fleet/$carId')({
  component: CarDetails,
    loader: async ({params}) => {
      const { data: car, error } = await supabase
          .from('cars')
          .select('*')
          .eq('id', params.carId)
          .single()
      if (error) throw new Error("Car not found")
        return { car }
    },
})

function CarDetails() {
  const { car } = Route.useLoaderData()
  const { carId } = Route.useParams()

    return (
        <div className="container mx-auto p-8">
            <h1 className="text-4xl font-bold">{car.make} {car.model}</h1>
            <p className="text-gray-600">Now viewing car ID: {carId}</p>
            {/* Rest of your UI for a single car goes here */}
        </div>
    )
}
