import { createFileRoute, Link } from '@tanstack/react-router'
import { MoveUpRight } from "lucide-react"

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
            <div className="absolute inset-0 z-10 bg-gradient-to-r from-black/40 via-black/20 to-transparent"></div>

            <div className="z-20 pb-50 px-16 md:px-40 ">
                <h1 className="text-white md:text-6xl mb-4 tracking-tight">
                    Less Hassle,
                </h1>
                <h1 className="text-white md:text-6xl mb-4 tracking-tight">
                    More Driving
                </h1>
                <p className="md:text-xl">
                    Rent from trusted locals in Minneapolis-St.Paul
                </p>

                <div className = "flex flex-col mt-8 gap-4">
                    <Link to="/fleet"
                          className="bg-white secondary-button font-semibold w-fit flex items-center gap-2"
                    >
                        Book Now <MoveUpRight size={14}/>
                    </Link>
                </div>

            </div>
        </main>
    )
}