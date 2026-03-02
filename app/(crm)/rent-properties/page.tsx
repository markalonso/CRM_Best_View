import { Suspense } from "react";
import RentPropertiesClient from "./RentPropertiesClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <RentPropertiesClient />
    </Suspense>
  );
}
