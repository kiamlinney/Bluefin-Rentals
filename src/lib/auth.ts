import { createServerFn } from "@tanstack/react-start";
import { getSupabaseServerClient } from "./supabase.server.ts";
import z from "zod";

export const getUser = createServerFn({ method: 'GET' })
    .handler(async() => {
        const supabase = getSupabaseServerClient()
        const { data: { user }, error } = await supabase.auth.getUser();

        if (error || !user) {
            console.warn("Auth check:", error?.message)
            return null;
        }

        return user;
    });

export const loginUser = createServerFn({ method: 'POST' })
    .inputValidator(z.object({
        email: z.string().email(),
        password: z.string()
    }))
    .handler(async({ data: formInput }) => {
        const supabase = getSupabaseServerClient()
        const { data, error } = await supabase.auth.signInWithPassword({
            email: formInput.email,
            password: formInput.password,
        });

        if (error || !data.user) {
            throw new Error(error?.message || "Login failed");
        }

        return data.user;
    });

export const signUpUser = createServerFn({ method: 'POST' })
    .inputValidator(z.object({
        email: z.string().email(),
        password: z.string()
    }))
    .handler(async({ data: formInput }) => {
        const supabase = getSupabaseServerClient()
        const { data, error } = await supabase.auth.signUp({
            email: formInput.email,
            password: formInput.password,
        });

        if (error || !data.user) {
            throw new Error(error?.message || "Sign Up failed");
        }

        return data.user;
    });

export const logoutUser = createServerFn({ method: 'POST' })
    .handler(async () => {
        const supabase = getSupabaseServerClient();
        const { error } = await supabase.auth.signOut();

        if (error) throw new Error(error.message);
    });