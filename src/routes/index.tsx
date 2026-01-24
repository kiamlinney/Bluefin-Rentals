import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Navbar from "../components/Navbar.tsx";

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
        <main className="min-h-screen bg-[url('/images/BG.svg')] bg-cover bg-center">
            <Navbar/>

            <section className="main-section container mx-auto px-4">
                <div className="page-heading py-16 text-center">
                    <h1 className="text-4xl font-bold">Less Hassle</h1>
                    <h1 className="text-4xl font-bold">More Driving</h1>
                    <p className="mt-2 text-gray-600">Rent from trusted locals in Minneapolis-St.Paul</p>
                </div>

                <div className="flex flex-col items-center justify-center mt-10 gap-4">
                    <Link
                        to="/cars"
                        className="primary-button px-6 py-3 bg-gray-600 text-white rounded-lg text-xl font-semibold hover:bg-gray-800 transition"
                    >
                        Browse Fleet
                    </Link>
                </div>
            </section>
        </main>
    )
}