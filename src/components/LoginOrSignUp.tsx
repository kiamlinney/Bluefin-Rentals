import { useState } from "react";
import { LoginForm } from "./LoginForm";
import { SignUpForm } from "./SignUpForm";

export const LoginOrSignUp = ({ redirect }: { redirect?: string }) => {
    const [isLogIn, setIsLogIn] = useState(false);
    return isLogIn ? (
        <LoginForm redirect={redirect} switchToSignUp={() => setIsLogIn(false)} />
    ) : (
        <SignUpForm redirect={redirect} switchToLogin={() => setIsLogIn(true)} />
    );
};