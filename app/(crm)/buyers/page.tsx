import { Suspense } from "react";
import BuyersClient from "./BuyersClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <BuyersClient />
    </Suspense>
  );
}
