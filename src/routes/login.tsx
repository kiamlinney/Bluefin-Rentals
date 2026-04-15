import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { LoginOrSignUp } from "@/components/LoginOrSignUp.tsx";

const loginSearchSchema = z.object({
    redirect: z.string().optional(),
})

export const Route = createFileRoute('/login')({
    validateSearch: loginSearchSchema,
    component: Login,
})

function Login() {
    const search = Route.useSearch()
    return <LoginOrSignUp redirect={search.redirect} />
}
