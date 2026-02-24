import { createServerClient } from "@supabase/ssr";
import { getCookies, setCookie } from "@tanstack/react-start/server";

export function getSupabaseServerClient() {
    return createServerClient(
        import.meta.env.VITE_SUPABASE_URL!,
        import.meta.env.VITE_SUPABASE_ANON_KEY!,
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