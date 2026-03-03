import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function resolveSupabaseEnv() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Server misconfigured: missing SUPABASE URL/KEY");
  return { url, key };
}

export function createSupabaseServerClient() {
  const { url, key } = resolveSupabaseEnv();
  const cookieStore = cookies();

  return createServerClient(url, key, {
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
