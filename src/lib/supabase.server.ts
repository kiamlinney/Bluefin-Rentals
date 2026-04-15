import { createServerClient } from "@supabase/ssr";
import { getCookies, setCookie } from "@tanstack/react-start/server";

export function getSupabaseServerClient() {
    // Prefer server-only SUPABASE_URL if present; fall back to the public VITE_ var.
    const supabaseUrl = process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL!;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY!;

    return createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
            cookies: {
                getAll() {
                    return Object.entries(getCookies()).map(([name, value]) => ({
                        name,
                        value: value || '',
                    }));
                },
                setAll(cookies) {
                    cookies.forEach((cookie) => {
                        setCookie(cookie.name, cookie.value, cookie.options);
                    });
                },
            },
        }
    );
}