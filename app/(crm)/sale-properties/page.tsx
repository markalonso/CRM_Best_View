import { Suspense } from "react";
import SalePropertiesClient from "./SalePropertiesClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <SalePropertiesClient />
    </Suspense>
  );
}
