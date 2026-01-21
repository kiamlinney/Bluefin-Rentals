import { createClient } from '@supabase/supabase-js'

// Vite uses 'import.meta.env' to grab variables from your .env file
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// This 'supabase' object is what you will import in your pages to get data
export const supabase = createClient(supabaseUrl, supabaseKey)