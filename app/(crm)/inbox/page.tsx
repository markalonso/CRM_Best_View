import { Suspense } from "react";
import InboxClient from "./InboxClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <InboxClient />
    </Suspense>
  );
}
