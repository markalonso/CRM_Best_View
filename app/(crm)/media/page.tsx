import { Suspense } from "react";
import { MediaBrowser } from "@/components/media/media-browser";

export default function MediaPage() {
  return (
    <Suspense fallback={<div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading media browser…</div>}>
      <MediaBrowser />
    </Suspense>
  );
}
