import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button.tsx"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { loginUser } from "@/lib/auth.ts";
import { useNavigate, useRouter } from "@tanstack/react-router"
import {useState} from "react";

type LoginFormProps = {
    switchToSignUp: ()=> void
}

export function LoginForm({switchToSignUp}: LoginFormProps) {
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

            setStatus("success");

            setTimeout(() => {
                navigate({ to: "/fleet" });
            }, 2000);

        } catch (err: any) {
            setStatus("error");
            setErrorMessage(err.message || "Invalid email or password. Please try again.");

            // Clearing password on failed attempt
            const passwordInput = document.getElementById("password") as HTMLInputElement;
            if (passwordInput) passwordInput.value = "";
        }
    };

    return (
        <div className={cn("flex flex-col gap-6 max-w-xl mx-auto p-12")}>
            <Card>
                <CardHeader>
                    <CardTitle>
                        {status === "success" ? "Welcome back!" : "Login to your account"}
                    </CardTitle>
                    <CardDescription>
                        {status === "success"
                            ? "Redirecting you to the fleet..."
                            : "Enter your email below to login to your account"}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {status !== "success" && (
                        <form onSubmit={handleSubmit}>
                            <FieldGroup>
                                {status === "error" && (
                                    <p className="text-red-500 text-sm font-medium">{errorMessage}</p>
                                )}
                                <Field>
                                    <FieldLabel htmlFor="email">Email</FieldLabel>
                                    <Input id="email" name="email" type="email" required />
                                </Field>
                                <Field>
                                    <FieldLabel htmlFor="password">Password</FieldLabel>
                                    <Input id="password" name="password" type="password" required />
                                </Field>
                                <Button type="submit" disabled={status === "loading"}>
                                    {status === "loading" ? "Logging in..." : "Login"}
                                </Button>
                                <FieldDescription className="text-center">
                                    Don&apos;t have an account?{" "}
                                    <button
                                        type="button"
                                        onClick={switchToSignUp}
                                        className="cursor-pointer underline hover:text-gray-900">
                                        Sign up
                                    </button>
                                </FieldDescription>
                            </FieldGroup>
                        </form>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
