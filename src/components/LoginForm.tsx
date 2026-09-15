import {getUserWithProfile, loginUser} from "@/lib/auth.ts";
import { useNavigate, useRouter } from "@tanstack/react-router"
import {useState} from "react";

type LoginFormProps = {
    switchToSignUp: ()=> void
    redirect?: string
}

export function LoginForm({switchToSignUp, redirect}: LoginFormProps) {
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [errorMessage, setErrorMessage] = useState("");
    const router = useRouter();

    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const email = formData.get("email") as string;
        const password = formData.get("password") as string;

        setStatus("loading");
        setErrorMessage("");

        try {
            await loginUser({
                data: { email, password },
            });

            await router.invalidate();

            const u = await getUserWithProfile()
            //setStatus("success");

            const isAdminPath = (p?: string) => !!p && p.startsWith('/admin')
            const next = u?.is_admin
                ? (isAdminPath(redirect) ? redirect!
                    : '/admin/trips/booked')
                : (redirect && !isAdminPath(redirect) ? redirect
                    : '/fleet')

            setTimeout(() => navigate({ to: next as any }), 200)
            //
            // setStatus("success");
            //
            // const safeRedirect = (r?: string) => (r && r.startsWith('/')) ? r : '/fleet'
            // setTimeout(() => {
            //     navigate({ to: safeRedirect(redirect) as any });
            // }, 200);

        } catch (err: any) {
            setStatus("error");
            setErrorMessage(err.message || "Invalid email or password. Please try again.");

            // Clearing password on failed attempt
            const passwordInput = document.getElementById("password") as HTMLInputElement;
            if (passwordInput) passwordInput.value = "";
        }
    };

    return (
        <div className="mt-12 flex flex-col gap-6 max-w-xl mx-auto p-12">
            <div className="rounded-xl border border-line bg-surface shadow">
                <div className="flex flex-col space-y-1.5 p-6">
                    <h2 className="font-semibold leading-none tracking-tight">
                        {status === "success" ? "Welcome back!" : "Login to your account"}
                    </h2>
                    <p className="text-sm text-muted">
                        {status === "success"
                            ? "Redirecting you to the fleet..."
                            : "Enter your email below to login to your account"}
                    </p>
                </div>
                <div className="p-6 pt-0">
                    {status !== "success" && (
                        <form onSubmit={handleSubmit} className="grid gap-4">
                            {status === "error" && (
                                <p className="text-red-500 text-sm font-medium">{errorMessage}</p>
                            )}
                            <div className="grid gap-2">
                                <label htmlFor="email" className="text-sm font-medium leading-none">Email</label>
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    required
                                    className="h-9 w-full rounded-md border border-line bg-transparent px-3 py-1 text-base md:text-sm shadow-sm transition-colors placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
                                />
                            </div>
                            <div className="grid gap-2">
                                <label htmlFor="password" className="text-sm font-medium leading-none">Password</label>
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    required
                                    className="h-9 w-full rounded-md border border-line bg-transparent px-3 py-1 text-base md:text-sm shadow-sm transition-colors placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={status === "loading"}
                                className="h-9 px-4 inline-flex items-center justify-center rounded-md bg-brand text-on-brand text-sm font-medium shadow hover:bg-pine-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-50"
                            >
                                {status === "loading" ? "Logging in..." : "Login"}
                            </button>
                            <p className="text-[0.8rem] text-muted text-center">
                                Don&apos;t have an account?{" "}
                                <button
                                    type="button"
                                    onClick={switchToSignUp}
                                    className="cursor-pointer underline hover:text-ink">
                                    Sign up
                                </button>
                            </p>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
