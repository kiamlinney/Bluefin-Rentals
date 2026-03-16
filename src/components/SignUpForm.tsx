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
    Field, FieldDescription,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { signUpUser } from "@/lib/auth.ts";
import {useNavigate, useRouter} from "@tanstack/react-router"
import {useState} from "react";

type SignUpFormProps = {
    switchToLogin: ()=> void
}

export function SignUpForm({ switchToLogin }: SignUpFormProps) {
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [errorMessage, setErrorMessage] = useState("");
    const navigate = useNavigate();
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const email = formData.get("email") as string;
        const password = formData.get("password") as string;

        // Password Length Check
        if (password.length < 6) {
            setErrorMessage("Password must be at least 6 characters.");
            setStatus("error");

            // Clearing only the password field
            const passwordInput = document.getElementById("password") as HTMLInputElement;
            if (passwordInput) passwordInput.value = "";
            return;
        }

        setStatus("loading");

        try {
            await signUpUser({ data: { email, password } });

            await router.invalidate();

            setStatus("success");

            setTimeout(() => {
                navigate({ to: "/fleet" });
            }, 2000);

        } catch (err: any) {
            setStatus("error");
            setErrorMessage(err.message || "Sign up failed. Please try again.");

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
                        {status === "success" ? "Sign up successful!" : "Create an account"}
                    </CardTitle>
                    <CardDescription>
                        {status === "success"
                            ? "Redirecting you to the fleet..."
                            : "Enter your email below to create an account"}
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
                                    {status === "loading" ? "Creating Account..." : "Sign Up"}
                                </Button>
                                <FieldDescription className="text-center">
                                    Already have an account?{" "}
                                    <button
                                        type="button"
                                        onClick={switchToLogin}
                                        className="cursor-pointer underline hover:text-gray-900">
                                        Login
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