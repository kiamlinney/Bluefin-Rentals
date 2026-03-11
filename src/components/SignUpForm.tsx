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
import {loginUser} from "@/lib/auth.ts";
import { useRouter } from "@tanstack/react-router"

type SignUpFormProps = {
    switchToLogin: ()=> void
}

export function SignUpForm({switchToLogin}: SignUpFormProps) {

    const router = useRouter();
    return (
        <div className={cn("flex flex-col gap-6 max-w-xl mx-auto p-12")}>
            <Card>
                <CardHeader>
                    <CardTitle>Create an account</CardTitle>
                    <CardDescription>
                        Enter your email below to create an account
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={async (e) => {
                        e.preventDefault();
                        const formData = new FormData(e.target as HTMLFormElement)
                        await loginUser({
                            data: {
                                email: formData.get("email") as string,
                                password: formData.get("password") as string,
                            },
                        });
                        router.invalidate();
                    }}
                    >
                        <FieldGroup>
                            <Field>
                                <FieldLabel htmlFor="email">Email</FieldLabel>
                                <Input
                                    id="email"
                                    name="email"
                                    type="email"
                                    placeholder="m@example.com"
                                    required
                                />
                            </Field>
                            <Field>
                                <div className="flex items-center">
                                    <FieldLabel htmlFor="password">Password</FieldLabel>
                                    <a
                                        href="#"
                                        className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                                    >
                                        Forgot your password?
                                    </a>
                                </div>
                                <Input id="password" name="password" type="password" required />
                            </Field>
                            <Field>
                                <Button type="submit">Login</Button>

                                <FieldDescription className="text-center">
                                    Already have an account?{" "}
                                    <button onClick={switchToLogin} className="underline">
                                        Login
                                    </button>
                                </FieldDescription>
                            </Field>
                        </FieldGroup>
                    </form>
                </CardContent>
            </Card>
        </div>
    )
}
