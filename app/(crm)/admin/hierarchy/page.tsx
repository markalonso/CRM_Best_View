import { Suspense } from "react";
import { HierarchyManager } from "@/components/hierarchy/hierarchy-manager";

export default function HierarchyAdminPage() {
  return (
    <Suspense fallback={<div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading hierarchy manager…</div>}>
      <HierarchyManager />
    </Suspense>
  );
}
