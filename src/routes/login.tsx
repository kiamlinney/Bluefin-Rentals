import { createFileRoute } from '@tanstack/react-router'
import {LoginOrSignUp} from "@/components/LoginOrSignUp.tsx";

export const Route = createFileRoute('/login')({
    component: Login,
})

function Login() {
    return <LoginOrSignUp />
}
