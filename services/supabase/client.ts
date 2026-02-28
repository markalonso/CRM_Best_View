import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export function createSupabaseClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
}
