import { createClient } from "@supabase/supabase-js";
import { getEnvSafe } from "@/lib/env";

export function createSupabaseClient() {
  const resolved = getEnvSafe();
  if (!resolved.ok) {
    throw new Error("Server misconfigured: missing SUPABASE URL/KEY");
  }

  return createClient(resolved.env.SUPABASE_URL, resolved.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
}
