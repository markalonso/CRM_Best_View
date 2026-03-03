import { Suspense } from "react";
import SaleClient from "./SaleClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <SaleClient />
    </Suspense>
  );
}
