import { useState } from "react";
import { LoginForm } from "./LoginForm";
import { SignUpForm } from "./SignUpForm";

export const LoginOrSignUp = () => {
    const [isLogIn, setIsLogIn] = useState(false);
    return isLogIn ? (
        <LoginForm switchToSignUp={() => setIsLogIn(false)} />
    ) : (
        <SignUpForm switchToLogin={() => setIsLogIn(true)} />
    );
};