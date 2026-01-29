import {createFileRoute, Link} from '@tanstack/react-router'

export const Route = createFileRoute('/fleet/')({
  component: Fleet,
})

function Fleet() {
    const fleet = ['1', '3', '4', '5', '6', '7', '8', '9']

    return (
        <div>
            {fleet.map((car) => (
                <div key={car}>
                    <Link
                        to="/fleet/$carId"
                        params={{
                            carId: car
                        }}
                    >{car}</Link>
                </div>
            ))}
        </div>
    )
}

/*
Use .finally() at the end to set isLoading to false
or in async syntact: finally {
set isLoading to true at the beginning of a fetch that gets the car data

asnyc function myFunction() {
    try {
        const result = await myPromise;
    } catch (error) {
        // handle error
    } finally {
        // Run once finished
    }
}

 */