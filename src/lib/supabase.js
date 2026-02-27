import { createClient } from "@supabase/supabase-js";

// Empfohlen über .env.local (siehe Schritt 5)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// HMR-safe singleton (verhindert mehrere GoTrueClient Instanzen in dev)
const globalKey = "__rideout_supabase__";

console.log(SUPABASE_ANON_KEY);
export const supabase =
  globalThis[globalKey] ??
  (globalThis[globalKey] = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }));
