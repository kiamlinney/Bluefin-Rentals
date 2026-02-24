import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
    component: Home,
})

function Home() {
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
}