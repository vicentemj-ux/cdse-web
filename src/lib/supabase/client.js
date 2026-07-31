import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.PUBLIC_SUPABASE_URL
  || import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY
  || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let browserClient;

export function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabaseClient() {
  if (!hasSupabaseConfig()) return null;
  if (!browserClient) {
    browserClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return browserClient;
}

export function getSupabaseFunctionsUrl() {
  return supabaseUrl ? `${supabaseUrl}/functions/v1` : '';
}
