"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { SIDEBAR_ITEMS, VIEW_MODES } from "./navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type CRMShellProps = {
  children: ReactNode;
};

type SearchResultItem = Record<string, any> & {
  id: string;
  href?: string;
  record_type?: string;
};

type QuickActionItem = {
  isAction: true;
  id: string;
  label: string;
  href: string;
};

type FlatItem = SearchResultItem | QuickActionItem;

export function CRMShell({ children }: CRMShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Array<{ key: string; label: string; count: number; items: SearchResultItem[] }>>([]);
  const [quickActions, setQuickActions] = useState<Array<{ id: string; label: string; href: string }>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const flatItems = useMemo<FlatItem[]>(() => {
    const rows = results.flatMap((group) => group.items);
    return [...rows, ...quickActions.map((action) => ({ ...action, isAction: true as const }))];
  }, [results, quickActions]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([]);
      setQuickActions([{ id: "quick-intake", label: "Quick create intake", href: "/inbox?quickCreate=1" }]);
      setActiveIndex(0);
      return;
    }

    const timer = setTimeout(async () => {
      const res = await fetch(`/api/search/global?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.groups || []);
      setQuickActions(data.quick_actions || []);
      setActiveIndex(0);
    }, 180);

    return () => clearTimeout(timer);
  }, [query, open]);

  function runSelection(item: FlatItem) {
    setOpen(false);
    const href = typeof item.href === "string" ? item.href : "/";
    router.push(href);
  }

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr] bg-slate-50 text-slate-900">
      <aside className="border-r border-slate-200 bg-white px-4 py-5">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">CRM</p>
          <h1 className="text-lg font-semibold">Best View</h1>
        </div>

        <nav className="space-y-1">
          {SIDEBAR_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="relative flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (!flatItems.length) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((prev) => (prev + 1) % flatItems.length);
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  runSelection(flatItems[activeIndex]);
                }
              }}
              placeholder="Global Search"
              className="h-10 w-[380px] rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none ring-0 placeholder:text-slate-400 focus:border-slate-500"
            />
            <button onClick={() => router.push("/inbox?quickCreate=1")} className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700">
              Add New Intake
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Notifications
            </button>
            <button
              onClick={async () => {
                const supabase = getSupabaseBrowserClient();
                await supabase.auth.signOut();
                router.replace("/auth/sign-in");
                router.refresh();
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Logout
            </button>
          </div>

          {open && (
            <div className="absolute left-[284px] top-14 z-50 max-h-[70vh] w-[640px] overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-2xl">
              <div className="mb-1 px-2 py-1 text-xs text-slate-500">⌘/Ctrl + K</div>
              {results.map((group) => (
                <div key={group.key} className="mb-2">
                  <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label} ({group.count})</p>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const index = flatItems.findIndex((entry) => entry.id === item.id && ("record_type" in entry ? entry.record_type : undefined) === item.record_type);
                      return (
                        <button key={`${item.record_type}-${item.id}`} onMouseDown={() => runSelection(item)} className={`block w-full rounded-lg px-2 py-2 text-left text-sm ${activeIndex === index ? "bg-slate-100" : "hover:bg-slate-50"}`}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-slate-900">{item.code}</p>
                            {item.needs_review && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Needs Review</span>}
                          </div>
                          <p className="text-xs text-slate-700">{item.primary_label}</p>
                          <p className="text-xs text-slate-500">{item.secondary_info}</p>
                          <p className="text-xs text-slate-500">📷 {item.media_counts?.images || 0} • 🎥 {item.media_counts?.videos || 0} • 📄 {item.media_counts?.documents || 0}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {quickActions.length > 0 && (
                <div>
                  <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</p>
                  {quickActions.map((action) => {
                    const index = flatItems.findIndex((entry) => entry.id === action.id);
                    return (
                      <button key={action.id} onMouseDown={() => runSelection({ ...action, isAction: true })} className={`block w-full rounded-lg px-2 py-2 text-left text-sm ${activeIndex === index ? "bg-slate-100" : "hover:bg-slate-50"}`}>
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {!results.length && !!query.trim() && <p className="px-2 py-3 text-xs text-slate-500">No results.</p>}
            </div>
          )}
        </header>

        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <p className="text-sm text-slate-500">Prepared layout modes for fast, data-first workflows.</p>
          <div className="flex items-center gap-2">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-100"
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
