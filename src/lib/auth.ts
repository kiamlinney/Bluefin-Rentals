import { createServerFn } from "@tanstack/react-start";
import { getSupabaseServerClient } from "./supabase.server.ts";

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