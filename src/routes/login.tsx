import { createFileRoute } from '@tanstack/react-router'
import { LoginForm } from "../components/LoginForm.tsx";

export const Route = createFileRoute('/login')({
    component: Login,
})

function Login() {
    return <LoginForm switchToSignUp={function(): void {
        throw new Error("Function not implemented.");
    } } />
}
