// import { createClient } from '@supabase/ssr'
//
// // Vite uses 'import.meta.env' to grab variables from your .env file
// const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
// const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
//
// // This 'supabase' object is what you will import in your pages to get data
// export const supabase = createClient(supabaseUrl, supabaseKey)

import { createServerClient } from "@supabase/ssr";
import { getCookies, setCookie } from "@tanstack/react-start/server";

export function getSupabaseServerClient() {
    return createServerClient(
        // Use import.meta.env for Vite projects!
        import.meta.env.VITE_SUPABASE_URL!,
        import.meta.env.VITE_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return Object.entries(getCookies()).map(([name, value]) => ({
                        name,
                        value: value || '', // Handle potential undefined values
                    }));
                },
                setAll(cookies) {
                    cookies.forEach((cookie) => {
                        // Options are passed automatically in newer versions
                        setCookie(cookie.name, cookie.value, cookie.options);
                    });
                },
            },
        }
    );
}