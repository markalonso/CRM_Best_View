import { Suspense } from "react";
import ClientsClient from "./ClientsClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <ClientsClient />
    </Suspense>
  );
}
