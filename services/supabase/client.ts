import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getEnvSafe } from "@/lib/env";

export function createSupabaseClient() {
  const resolved = getEnvSafe();
  if (!resolved.ok) throw new Error("Server misconfigured: missing SUPABASE URL/KEY");

  const cookieStore = cookies();

  return createServerClient(resolved.env.SUPABASE_URL, resolved.env.SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        try {
          cookieStore.set({ name, value, ...(options as object) });
        } catch {}
      },
      remove(name: string, options: Record<string, unknown>) {
        try {
          cookieStore.set({ name, value: "", ...(options as object), maxAge: 0 });
        } catch {}
      }
    }
  });
}
