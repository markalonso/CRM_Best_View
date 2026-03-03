"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useSearchParams } from "next/navigation";

type TaskRow = {
  id: string;
  related_type: "sale" | "rent" | "buyer" | "client" | "contact";
  related_id: string;
  title: string;
  due_date: string | null;
  status: "open" | "done" | "cancelled";
  assigned_to: string | null;
  assigned_to_name?: string | null;
  created_at: string;
};

const VIEWS = [
  { id: "my", label: "My Tasks" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" }
] as const;

function rel(date: string | null) {
  if (!date) return "No due date";
  const diff = new Date(date).getTime() - Date.now();
  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return `in ${days}d`;
}

export default function TasksClient() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const isViewer = (user?.role || "viewer") === "viewer";
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("my");
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/tasks?view=${view}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setRows(data.tasks || []);
    else setRows([]);
    setLoading(false);
  }

  useEffect(() => {
    const viewFromQuery = (searchParams.get("view") || "") as (typeof VIEWS)[number]["id"];
    if (viewFromQuery && VIEWS.some((v) => v.id === viewFromQuery)) {
      setView(viewFromQuery);
    }
  }, [searchParams]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  async function markDone(id: string) {
    if (isViewer) return;
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" })
    });
    if (res.ok) load();
  }

  const grouped = useMemo(() => {
    return rows.reduce<Record<string, TaskRow[]>>((acc, row) => {
      const key = row.status;
      acc[key] = acc[key] || [];
      acc[key].push(row);
      return acc;
    }, {});
  }, [rows]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <div className="flex gap-2">
          {VIEWS.map((item) => (
            <button key={item.id} onClick={() => setView(item.id)} className={`rounded border px-3 py-1 text-sm ${view === item.id ? "bg-slate-900 text-white" : "border-slate-300"}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading tasks...</p>}

      {!loading && (
        <div className="grid gap-3 lg:grid-cols-2">
          {(["open", "done", "cancelled"] as const).map((status) => (
            <div key={status} className="rounded-xl border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-semibold uppercase text-slate-700">{status} ({(grouped[status] || []).length})</h3>
              <div className="space-y-2">
                {(grouped[status] || []).map((task) => (
                  <div key={task.id} className="rounded border border-slate-200 p-2 text-sm">
                    <p className="font-medium">{task.title}</p>
                    <p className="text-xs text-slate-500">{task.related_type} • {task.related_id.slice(0, 8)} • {task.assigned_to_name || "Unassigned"}</p>
                    <p className={`text-xs ${task.status === "open" && task.due_date && new Date(task.due_date).getTime() < Date.now() ? "text-red-600" : "text-slate-500"}`}>{rel(task.due_date)}</p>
                    {task.status === "open" && (
                      <button disabled={isViewer} onClick={() => markDone(task.id)} className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">Mark done</button>
                    )}
                  </div>
                ))}
                {(grouped[status] || []).length === 0 && <p className="text-xs text-slate-500">No tasks.</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
