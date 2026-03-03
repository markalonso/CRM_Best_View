import { Suspense } from "react";
import TasksClient from "./TasksClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <TasksClient />
    </Suspense>
  );
}
