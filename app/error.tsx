"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isChunkError = /chunk|loading chunk|ChunkLoadError/i.test(error?.message || "");

  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html>
      <body className="p-6">
        <h2 className="text-xl font-semibold">Application error</h2>
        <p className="mt-2 text-sm text-slate-600">
          {isChunkError ? "Update available. Please refresh the page." : "A client-side error occurred."}
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => window.location.reload()} className="rounded bg-slate-900 px-4 py-2 text-white">
            Refresh
          </button>
          <button onClick={() => reset()} className="rounded border border-slate-300 px-4 py-2">
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
