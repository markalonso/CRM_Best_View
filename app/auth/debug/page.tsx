"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AuthDebugPage() {
  const [chunkStatus, setChunkStatus] = useState("Checking...");
  const [sessionStatus, setSessionStatus] = useState("Checking...");

  useEffect(() => {
    (async () => {
      try {
        const scripts = Array.from(document.querySelectorAll('script[src*="/_next/static/chunks/"]')) as HTMLScriptElement[];
        const scriptSrc = scripts[0]?.src;
        if (!scriptSrc) {
          setChunkStatus("No chunk script tag found on this page.");
        } else {
          const res = await fetch(scriptSrc, { method: "GET" });
          setChunkStatus(`${res.status} ${res.ok ? "OK" : "FAIL"} ${scriptSrc}`);
        }
      } catch (error) {
        setChunkStatus(`Chunk check failed: ${error instanceof Error ? error.message : "unknown"}`);
      }

      try {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        setSessionStatus(data.session ? `Session loaded (${data.session.user.email || data.session.user.id})` : "No active session");
      } catch (error) {
        setSessionStatus(`Session check failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
    })();
  }, []);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Auth/Chunk Debug</h1>
      <p className="rounded border p-3 text-sm">Chunk status: {chunkStatus}</p>
      <p className="rounded border p-3 text-sm">Supabase session: {sessionStatus}</p>
    </main>
  );
}
