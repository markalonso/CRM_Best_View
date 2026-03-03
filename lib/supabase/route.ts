import { createSupabaseServerClient } from "@/lib/supabase/server";

export function createSupabaseRouteClient() {
  return createSupabaseServerClient();
}
