import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

export const Route = createFileRoute('/')({
    component: Index,
})

function Index() {
    useEffect(() => {
        async function testConnection() {
            const { data, error } = await supabase.from('cars').select('*')

            if (error) {
                console.error('Error connecting to Supabase:', error.message)
            } else {
                console.log('Success! Here are your cars:', data)
            }
        }

        testConnection()
    }, [])
    return (
        <main className="relative min-h-screen w-full flex items-center justify-start overflow-hidden">
            {/* Video Background */}
            <video
                autoPlay
                muted
                loop
                playsInline
                className="absolute z-0 w-auto min-w-full min-h-full max-w-none scale-x-[-1]"
            >
                <source src="/background.mp4" type="video/mp4" />
                Your browser does not support the video tag.
            </video>

            {/* Dark Overlay */}
            <div className="absolute inset-0 z-10 bg-gradient-to-r from-black/80 via-black/20 to-transparent"></div>

            {/* The Content */}
            <div className="relative z-20 pb-50 px-16 md:px-40 text-white">
                <h1 className="text-gray-300 md:text-6xl font-bold mb-4 tracking-tight">
                    Less Hassle
                </h1>
                <h1 className="text-gray-300 md:text-6xl font-bold mb-4 tracking-tight">
                    More Driving
                </h1>
                <p className="text-gray-300 md:text-3xl">
                    Rent from trusted locals in Minneapolis-St.Paul
                </p>

                <div className = "flex flex-col mt-10 gap-4">
                    <Link to="/fleet" className="primary-button w-fit text-xl font-semibold">
                        Book Now
                    </Link>
                </div>

            </div>
        </main>
    )
    // return ( <button type="button" class="text-body bg-neutral-primary border border-default hover:bg-neutral-secondary-soft hover:text-heading focus:ring-4 focus:ring-neutral-tertiary font-medium leading-5 rounded-base text-sm px-4 py-2.5 focus:outline-none">Gray</button>
    //     <main className="min-h-screen bg-[url('/images/BG.svg')] bg-cover bg-center">
    //
    //         <section className="main-section container mx-auto px-4">
    //             <div className="page-heading py-16 text-center">
    //                 <h1 className="text-4xl font-bold">Less Hassle</h1>
    //                 <h1 className="text-4xl font-bold">More Driving</h1>
    //                 <p className="mt-2 text-gray-600">Rent from trusted locals in Minneapolis-St.Paul</p>
    //             </div>
    //
    //             <div className="flex flex-col items-center justify-center mt-10 gap-4">
    //                 <Link
    //                     to="/fleet"
    //                     className="primary-button px-6 py-3 bg-gray-600 text-white rounded-lg text-xl font-semibold hover:bg-gray-800 transition"
    //                 >
    //                     Browse Fleet
    //                 </Link>
    //             </div>
    //         </section>
    //     </main>
    // )
}