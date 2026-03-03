import { Suspense } from "react";
import RentClient from "./RentClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <RentClient />
    </Suspense>
  );
}
