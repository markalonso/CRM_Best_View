"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";

type GridType = "sale" | "rent" | "buyer" | "client";

type GridColumn = {
  key: string;
  label: string;
  editable?: boolean;
  width?: number;
};

type GridRow = Record<string, unknown> & {
  id: string;
  code?: string;
  completeness_score?: number;
  created_at?: string;
  updated_at?: string;
  media_counts?: { images: number; videos: number; documents: number };
};

type Sort = { field: string; direction: "asc" | "desc" };
type Range = { min?: string; max?: string };
type GridFilters = {
  search?: string;
  price?: Range;
  currency?: string;
  size?: Range;
  bedrooms?: Range;
  bathrooms?: Range;
  areas?: string[];
  compounds?: string[];
  floor?: Range;
  furnished?: string;
  finishing?: string;
  payment_terms?: string;
  status?: string;
  has_media?: "yes" | "no";
  min_media_count?: string;
  created_from?: string;
  created_to?: string;
  updated_from?: string;
  updated_to?: string;
  source?: string;
  completeness?: Range;
  preset?: string;

  budget?: Range;
  intent?: string;
  preferred_areas?: string[];
  property_type?: string;
  bedrooms_needed_min?: string;
  move_timeline?: string;
  last_contact_from?: string;
  last_contact_to?: string;
  requirements_missing?: "yes" | "no";

  client_type?: string;
  city_area?: string;
  has_active_listings?: "yes" | "no";
  phone_exists?: "yes" | "no";
  tags?: string[];
};

type SavedView = {
  id: string;
  name: string;
  filters: GridFilters;
  sorts: Sort[];
  hidden: Record<string, boolean>;
  pinned: string[];
};

const columnsByType: Record<GridType, GridColumn[]> = {
  sale: [
    { key: "code", label: "Code", width: 160 },
    { key: "status", label: "Status", editable: true, width: 120 },
    { key: "source", label: "Source", editable: true, width: 140 },
    { key: "price", label: "Price", editable: true, width: 120 },
    { key: "currency", label: "Currency", editable: true, width: 100 },
    { key: "size_sqm", label: "Size", editable: true, width: 110 },
    { key: "bedrooms", label: "Beds", editable: true, width: 80 },
    { key: "bathrooms", label: "Baths", editable: true, width: 80 },
    { key: "area", label: "Area", editable: true, width: 150 },
    { key: "compound", label: "Compound", editable: true, width: 150 },
    { key: "notes", label: "Notes", editable: true, width: 220 }
  ],
  rent: [
    { key: "code", label: "Code", width: 160 },
    { key: "status", label: "Status", editable: true, width: 120 },
    { key: "source", label: "Source", editable: true, width: 140 },
    { key: "price", label: "Price", editable: true, width: 120 },
    { key: "currency", label: "Currency", editable: true, width: 100 },
    { key: "size_sqm", label: "Size", editable: true, width: 110 },
    { key: "bedrooms", label: "Beds", editable: true, width: 80 },
    { key: "bathrooms", label: "Baths", editable: true, width: 80 },
    { key: "area", label: "Area", editable: true, width: 150 },
    { key: "compound", label: "Compound", editable: true, width: 150 },
    { key: "notes", label: "Notes", editable: true, width: 220 }
  ],
  buyer: [
    { key: "code", label: "Code", width: 160 },
    { key: "status", label: "Status", editable: true, width: 120 },
    { key: "source", label: "Source", editable: true, width: 140 },
    { key: "budget_min", label: "Budget Min", editable: true, width: 130 },
    { key: "budget_max", label: "Budget Max", editable: true, width: 130 },
    { key: "preferred_areas", label: "Preferred Areas", editable: true, width: 220 }
  ],
  client: [
    { key: "code", label: "Code", width: 160 },
    { key: "status", label: "Status", editable: true, width: 120 },
    { key: "name", label: "Name", editable: true, width: 160 },
    { key: "phone", label: "Phone", editable: true, width: 150 },
    { key: "role", label: "Role", editable: true, width: 130 },
    { key: "source", label: "Source", editable: true, width: 140 }
  ]
};

const defaultViewsByType: Record<GridType, Array<{ id: string; name: string; filters: GridFilters }>> = {
  sale: [
    { id: "new_today", name: "New Today", filters: { preset: "new_today" } },
    { id: "missing_price", name: "Missing Price", filters: { preset: "missing_price" } },
    { id: "missing_location", name: "Missing Location", filters: { preset: "missing_location" } },
    { id: "needs_review", name: "Needs Review", filters: { preset: "needs_review" } },
    { id: "no_media", name: "Has No Media", filters: { has_media: "no" } },
    { id: "high_budget", name: "High Budget (top 20%)", filters: { preset: "high_budget" } }
  ],
  rent: [
    { id: "new_today", name: "New Today", filters: { preset: "new_today" } },
    { id: "missing_price", name: "Missing Price", filters: { preset: "missing_price" } },
    { id: "missing_location", name: "Missing Location", filters: { preset: "missing_location" } },
    { id: "needs_review", name: "Needs Review", filters: { preset: "needs_review" } },
    { id: "no_media", name: "Has No Media", filters: { has_media: "no" } },
    { id: "high_budget", name: "High Budget (top 20%)", filters: { preset: "high_budget" } }
  ],
  buyer: [
    { id: "hot_buyers", name: "Hot Buyers", filters: { preset: "hot_buyers" } },
    { id: "budget_gt_x", name: "Budget > X", filters: { preset: "budget_gt_x" } },
    { id: "missing_phone", name: "Missing Phone", filters: { preset: "missing_phone" } },
    { id: "missing_preferred_areas", name: "Missing Preferred Areas", filters: { preset: "missing_preferred_areas" } },
    { id: "active_this_week", name: "Active This Week", filters: { preset: "active_this_week" } }
  ],
  client: [
    { id: "new_clients", name: "New Clients", filters: { preset: "new_clients" } },
    { id: "missing_phone", name: "Missing Phone", filters: { preset: "missing_phone" } },
    { id: "brokers", name: "Brokers", filters: { preset: "brokers" } },
    { id: "has_active_listings", name: "Has Active Listings", filters: { preset: "has_active_listings" } }
  ]
};

function relTime(v?: string) {
  if (!v) return "-";
  const d = Math.floor((Date.now() - new Date(v).getTime()) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function scoreColor(score: number) {
  if (score >= 80) return "bg-emerald-100 text-emerald-700";
  if (score >= 50) return "bg-amber-100 text-amber-700";
  return "bg-orange-100 text-orange-700";
}



function extractFiltersFromParams(params: URLSearchParams): GridFilters {
  const filters: GridFilters = {};
  const status = params.get("status");
  const preset = params.get("preset");
  const requirementsMissing = params.get("requirements_missing");
  const phoneExists = params.get("phone_exists");
  const source = params.get("source");
  const search = params.get("q") || params.get("search");

  if (status) filters.status = status;
  if (preset) filters.preset = preset;
  if (requirementsMissing === "yes" || requirementsMissing === "no") filters.requirements_missing = requirementsMissing;
  if (phoneExists === "yes" || phoneExists === "no") filters.phone_exists = phoneExists;
  if (source) filters.source = source;
  if (search) filters.search = search;

  return filters;
}
function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\n") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function CRMGrid({ type }: { type: GridType }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const isViewer = (user?.role || "viewer") === "viewer";
  const [rows, setRows] = useState<GridRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [infinite, setInfinite] = useState(false);
  const [sorts, setSorts] = useState<Sort[]>([{ field: "updated_at", direction: "desc" }]);
  const [filters, setFilters] = useState<GridFilters>({});

  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [showChooser, setShowChooser] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [newRawText, setNewRawText] = useState("");
  const [newFiles, setNewFiles] = useState<File[]>([]);

  const [editing, setEditing] = useState<{ rowId: string; key: string; value: string } | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; loading: boolean; data: any | null }>({ open: false, loading: false, data: null });
  const [contactQuery, setContactQuery] = useState("");
  const [contactMatches, setContactMatches] = useState<Array<{ id: string; name: string; phone: string | null }>>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskAssignedTo, setTaskAssignedTo] = useState("");
  const [authError, setAuthError] = useState("");


  function handleUnauthorized() {
    setAuthError("Please sign in");
    if (typeof window !== "undefined") window.alert("Please sign in");
    router.replace("/auth/sign-in");
  }
  const [columnOrder, setColumnOrder] = useState<string[]>(columnsByType[type].map((c) => c.key));
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [widths, setWidths] = useState<Record<string, number>>(() => Object.fromEntries(columnsByType[type].map((c) => [c.key, c.width || 140])));
  const [pinnedColumns, setPinnedColumns] = useState<string[]>(columnsByType[type].slice(0, 2).map((c) => c.key));

  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState("");
  const [saveViewName, setSaveViewName] = useState("");

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const columns = useMemo(() => {
    const map = new Map(columnsByType[type].map((c) => [c.key, c]));
    return columnOrder.map((k) => map.get(k)).filter(Boolean) as GridColumn[];
  }, [type, columnOrder]);

  const selectedCount = Object.values(selectedRows).filter(Boolean).length;

  async function loadRows(reset = false) {
    setLoading(true);
    const query = new URLSearchParams({
      type,
      page: String(reset ? 1 : page),
      pageSize: String(pageSize),
      sort: sorts.map((s) => `${s.field}:${s.direction}`).join(","),
      filters: JSON.stringify(filters)
    });

    const res = await fetch(`/api/grid/records?${query.toString()}`, { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      handleUnauthorized();
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    const data = await res.json();
    const incoming = (data.rows || []) as GridRow[];

    setRows((prev) => (reset || !infinite ? incoming : [...prev, ...incoming]));
    setTotal(Number(data.total || 0));
    setLoading(false);
  }

  useEffect(() => {
    const key = `crm-grid-views-${type}`;
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "[]") as SavedView[];
      setSavedViews(stored);
    } catch {
      setSavedViews([]);
    }
  }, [type]);

  useEffect(() => {
    setPage(1);
    loadRows(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, sorts, filters]);

  useEffect(() => {
    if (!infinite) return;
    const target = sentinelRef.current;
    if (!target) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && rows.length < total && !loading) {
          setPage((p) => p + 1);
        }
      });
    });
    io.observe(target);
    return () => io.disconnect();
  }, [infinite, rows.length, total, loading]);

  useEffect(() => {
    if (page > 1) loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);


  useEffect(() => {
    const nextFilters = extractFiltersFromParams(searchParams);
    if (Object.keys(nextFilters).length === 0) return;
    setFilters((prev) => ({ ...prev, ...nextFilters }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function toggleSort(field: string, withShift: boolean) {
    setSorts((prev) => {
      const found = prev.find((s) => s.field === field);
      const next = found ? (found.direction === "asc" ? "desc" : "asc") : "asc";
      if (!withShift) return [{ field, direction: next }];
      const rest = prev.filter((s) => s.field !== field);
      return [...rest, { field, direction: next }];
    });
  }

  async function saveInline(rowId: string, key: string, value: string) {
    const res = await fetch("/api/grid/records", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, record_id: rowId, field: key, value })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;

    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [key]: data.normalized ?? value } : r)));
    setEditing(null);
  }

  function renderCell(row: GridRow, col: GridColumn) {
    const isEditing = editing?.rowId === row.id && editing.key === col.key;
    const raw = row[col.key];
    const value = Array.isArray(raw) ? raw.join(", ") : String(raw ?? "");

    if (isEditing) {
      return (
        <input
          autoFocus
          value={editing.value}
          onChange={(e) => setEditing((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveInline(row.id, col.key, editing.value);
            if (e.key === "Escape") setEditing(null);
          }}
          onBlur={() => setEditing(null)}
          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
        />
      );
    }

    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (col.editable && !isViewer) setEditing({ rowId: row.id, key: col.key, value });
        }}
        className={`w-full text-left text-xs ${col.editable && !isViewer ? "hover:underline" : ""}`}
      >
        {value || "-"}
      </button>
    );
  }



  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId || loading) return;
    if (rows.some((row) => row.id === openId)) openDrawer(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, rows, loading]);
  async function openDrawer(id: string) {
    setDrawer({ open: true, loading: true, data: null });
    const res = await fetch(`/api/grid/record-detail?type=${type}&id=${id}`, { cache: "no-store" });
    const data = await res.json();
    setDrawer({ open: true, loading: false, data });
  }

  async function searchContacts() {
    const q = contactQuery.trim();
    if (!q) {
      setContactMatches([]);
      return;
    }
    const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    setContactMatches(data.contacts || []);
  }

  async function linkContact(contactId: string) {
    if (!drawer.data?.record?.id) return;
    const res = await fetch("/api/grid/record-detail", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id: drawer.data.record.id, action: "link_existing_contact", contact_id: contactId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    setDrawer((prev) => (prev.data ? { ...prev, data: { ...prev.data, linked_contact: data.linked_contact, record: { ...prev.data.record, contact_id: data.linked_contact?.id } } } : prev));
    setContactMatches([]);
    setContactQuery("");
  }

  async function createContactFromDrawer() {
    if (!drawer.data?.record?.id) return;
    const name = window.prompt("Contact name") || "";
    const phone = window.prompt("Contact phone (optional)") || "";
    const res = await fetch("/api/grid/record-detail", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id: drawer.data.record.id, action: "create_contact", name, phone })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    setDrawer((prev) => (prev.data ? { ...prev, data: { ...prev.data, linked_contact: data.linked_contact, record: { ...prev.data.record, contact_id: data.linked_contact?.id } } } : prev));
  }

  function relatedTypeFromGridType(value: GridType): "sale" | "rent" | "buyer" | "client" {
    if (value === "sale") return "sale";
    if (value === "rent") return "rent";
    if (value === "buyer") return "buyer";
    return "client";
  }

  async function createTask(relatedType: "sale" | "rent" | "buyer" | "client" | "contact", relatedId: string) {
    if (isViewer || !taskTitle.trim() || !relatedId) return;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        related_type: relatedType,
        related_id: relatedId,
        title: taskTitle.trim(),
        due_date: taskDueDate || null,
        assigned_to: taskAssignedTo || null
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;

    setDrawer((prev) => {
      if (!prev.data) return prev;
      const key = relatedType === "contact" ? "contact_tasks" : "tasks";
      return {
        ...prev,
        data: {
          ...prev.data,
          [key]: [data.task, ...((prev.data[key] || []) as any[])]
        }
      };
    });
    setTaskTitle("");
    setTaskDueDate("");
  }

  async function updateTask(taskId: string, updates: Record<string, unknown>) {
    if (isViewer) return;
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;

    setDrawer((prev) => {
      if (!prev.data) return prev;
      const patch = (arr: any[]) => arr.map((task) => (task.id === taskId ? { ...task, ...data.task } : task));
      return {
        ...prev,
        data: {
          ...prev.data,
          tasks: patch(prev.data.tasks || []),
          contact_tasks: patch(prev.data.contact_tasks || [])
        }
      };
    });
  }

  function pinLeft(key: string) {
    const index = pinnedColumns.indexOf(key);
    if (index === -1) return undefined;
    let offset = 40;
    for (let i = 0; i < index; i += 1) {
      offset += widths[pinnedColumns[i]] || 140;
    }
    return offset;
  }

  function isPinned(key: string) {
    return pinnedColumns.includes(key);
  }

  function saveCurrentView() {
    if (!saveViewName.trim()) return;
    const next: SavedView = {
      id: `view_${Date.now()}`,
      name: saveViewName.trim(),
      filters,
      sorts,
      hidden,
      pinned: pinnedColumns
    };
    const all = [...savedViews, next];
    setSavedViews(all);
    localStorage.setItem(`crm-grid-views-${type}`, JSON.stringify(all));
    setSaveViewName("");
  }

  function applyView(id: string) {
    setSelectedViewId(id);
    const preset = defaultViewsByType[type].find((v) => v.id === id);
    if (preset) {
      setFilters(preset.filters);
      return;
    }
    const custom = savedViews.find((v) => v.id === id);
    if (!custom) return;
    setFilters(custom.filters);
    setSorts(custom.sorts);
    setHidden(custom.hidden);
    setPinnedColumns(custom.pinned.length ? custom.pinned : columnsByType[type].slice(0, 2).map((c) => c.key));
  }

  async function exportCsv() {
    const query = new URLSearchParams({
      type,
      page: "1",
      pageSize: "3000",
      sort: sorts.map((s) => `${s.field}:${s.direction}`).join(","),
      filters: JSON.stringify(filters)
    });
    const res = await fetch(`/api/grid/records?${query.toString()}`, { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      handleUnauthorized();
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    const data = await res.json();
    const exportRows = (data.rows || []) as GridRow[];

    const visibleCols = columns.filter((c) => !hidden[c.key]);
    const headers = [...visibleCols.map((c) => c.label), "Media", "Completeness", "Updated"];
    const lines = [headers.join(",")];

    exportRows.forEach((r) => {
      const values = visibleCols.map((c) => {
        const raw = r[c.key];
        return csvEscape(Array.isArray(raw) ? raw.join(" | ") : raw ?? "");
      });
      values.push(csvEscape(`📷 ${r.media_counts?.images || 0} | 🎥 ${r.media_counts?.videos || 0} | 📄 ${r.media_counts?.documents || 0}`));
      values.push(csvEscape(`${Number(r.completeness_score || 0)}%`));
      values.push(csvEscape(String(r.updated_at || "")));
      lines.push(values.join(","));
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-grid.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }



  async function exportGoogleSheets() {
    const currentOnly = window.confirm("Export current filtered results? Click Cancel for full dataset.");
    const query = new URLSearchParams({
      type,
      page: "1",
      pageSize: "3000",
      sort: sorts.map((s) => `${s.field}:${s.direction}`).join(","),
      filters: JSON.stringify(currentOnly ? filters : {})
    });

    const res = await fetch(`/api/grid/records?${query.toString()}`, { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      handleUnauthorized();
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    const data = await res.json();
    const rows = (data.rows || []) as Array<Record<string, unknown>>;

    const spreadsheetInput = window.prompt("Google Spreadsheet URL or ID (optional; leave empty to create/use default)", "") || "";

    const exportRes = await fetch("/api/integrations/sheets/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset: type, rows, spreadsheet_id: spreadsheetInput || undefined })
    });

    const exportData = await exportRes.json();
    if (!exportRes.ok) {
      alert(exportData.error || "Google Sheets export failed");
      return;
    }

    alert(`Exported ${exportData.rowCount || rows.length} rows to ${exportData.tabName}.
${exportData.spreadsheetUrl || ""}`);
  }

  async function createIntake() {
    if (!newRawText.trim()) return;
    const form = new FormData();
    form.set("raw_text", newRawText);
    newFiles.forEach((f) => form.append("files", f));
    const res = await fetch("/api/inbox/sessions", { method: "POST", body: form });
    if (res.ok) {
      setShowIntakeModal(false);
      setNewRawText("");
      setNewFiles([]);
    }
  }

  return (
    <div className="relative rounded-xl border border-slate-200 bg-white shadow-sm">
      {(
        <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <input
            value={filters.search || ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            placeholder="Search code, phone, name, area, compound, notes"
            className="h-9 flex-1 rounded border border-slate-300 px-3 text-sm"
          />
          <button onClick={() => setShowFilters(true)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Filters</button>

          <select value={selectedViewId} onChange={(e) => applyView(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Views</option>
            {defaultViewsByType[type].map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            {savedViews.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>

          <button onClick={exportCsv} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Export CSV</button>
          <button onClick={exportGoogleSheets} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Export to Google Sheets</button>
          <button disabled={isViewer} onClick={() => setShowIntakeModal(true)} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">New Intake</button>
        </div>
      )}

      <div className="sticky top-[48px] z-20 flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="uppercase">{type}</span>
          <span className="text-xs text-slate-500">{total} records</span>
          {isViewer && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">Read only</span>}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600">
            <input type="checkbox" checked={infinite} onChange={(e) => setInfinite(e.target.checked)} className="mr-1" />
            Infinite scroll
          </label>
          <button onClick={() => setShowChooser((s) => !s)} className="rounded border border-slate-300 px-2 py-1 text-xs">Columns</button>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 py-2 text-xs">
          <span>{selectedCount} selected</span>
          <button className="rounded border border-slate-300 px-2 py-1">Bulk set Active</button>
          <button className="rounded border border-slate-300 px-2 py-1">Bulk set Needs Review</button>
          <button className="rounded border border-slate-300 px-2 py-1" onClick={() => setSelectedRows({})}>Clear</button>
        </div>
      )}

      {showChooser && (
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <div className="flex flex-wrap gap-3">
            {columnsByType[type].map((c) => (
              <label key={c.key} className="inline-flex items-center gap-1">
                <input type="checkbox" checked={!hidden[c.key]} onChange={() => setHidden((prev) => ({ ...prev, [c.key]: !prev[c.key] }))} />
                {c.label}
              </label>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <input value={saveViewName} onChange={(e) => setSaveViewName(e.target.value)} placeholder="Save current view" className="rounded border border-slate-300 px-2 py-1" />
            <button onClick={saveCurrentView} className="rounded border border-slate-300 px-2 py-1">Save View (private)</button>
          </div>
        </div>
      )}

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100">
            <tr>
              <th className="sticky left-0 z-30 w-10 border-b border-slate-200 bg-slate-100 px-2 py-2">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && rows.every((r) => selectedRows[r.id])}
                  onChange={(e) => {
                    const next: Record<string, boolean> = {};
                    rows.forEach((r) => (next[r.id] = e.target.checked));
                    setSelectedRows(next);
                  }}
                />
              </th>

              {columns.map((col) => {
                if (hidden[col.key]) return null;
                const pinned = isPinned(col.key);
                return (
                  <th
                    key={col.key}
                    style={{ width: widths[col.key], minWidth: widths[col.key], left: pinned ? pinLeft(col.key) : undefined }}
                    className={`${pinned ? "sticky z-20 bg-slate-100" : ""} border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold`}
                  >
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => toggleSort(col.key, e.shiftKey)} className="truncate">{col.label}</button>
                      <button onClick={() => setColumnOrder((prev) => {
                        const i = prev.indexOf(col.key); if (i <= 0) return prev;
                        const n = [...prev]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n;
                      })} className="text-[10px]">◀</button>
                      <button onClick={() => setColumnOrder((prev) => {
                        const i = prev.indexOf(col.key); if (i === -1 || i >= prev.length - 1) return prev;
                        const n = [...prev]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n;
                      })} className="text-[10px]">▶</button>
                      <button
                        onClick={() => setPinnedColumns((prev) => {
                          if (prev.includes(col.key)) return prev.filter((k) => k !== col.key);
                          return [...prev, col.key].slice(0, 2);
                        })}
                        className={`text-[10px] ${isPinned(col.key) ? "text-slate-900" : "text-slate-400"}`}
                      >📌</button>
                      <span
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const startX = e.clientX;
                          const startW = widths[col.key] || 140;
                          const move = (ev: MouseEvent) => setWidths((prev) => ({ ...prev, [col.key]: Math.max(90, startW + (ev.clientX - startX)) }));
                          const up = () => {
                            window.removeEventListener("mousemove", move);
                            window.removeEventListener("mouseup", up);
                          };
                          window.addEventListener("mousemove", move);
                          window.addEventListener("mouseup", up);
                        }}
                        className="ml-auto cursor-col-resize select-none text-slate-400"
                      >
                        ⋮
                      </span>
                    </div>
                  </th>
                );
              })}

              <th className="border-b border-slate-200 px-2 py-2 text-left text-xs">Media</th>
              <th className="border-b border-slate-200 px-2 py-2 text-left text-xs">Completeness</th>
              <th className="border-b border-slate-200 px-2 py-2 text-left text-xs">Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && Array.from({ length: 8 }).map((_, i) => (
              <tr key={`s-${i}`} className="animate-pulse border-b border-slate-100">
                <td className="h-10 bg-slate-50" colSpan={columns.length + 4} />
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 4} className="px-3 py-10 text-center text-sm text-slate-500">No records found.</td>
              </tr>
            )}

            {rows.map((row) => (
              <tr key={row.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => openDrawer(row.id)}>
                <td className="sticky left-0 z-10 bg-white px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={!!selectedRows[row.id]} onChange={(e) => setSelectedRows((prev) => ({ ...prev, [row.id]: e.target.checked }))} />
                </td>

                {columns.map((col) => {
                  if (hidden[col.key]) return null;
                  const pinned = isPinned(col.key);
                  return (
                    <td
                      key={`${row.id}-${col.key}`}
                      style={{ width: widths[col.key], minWidth: widths[col.key], left: pinned ? pinLeft(col.key) : undefined }}
                      className={`${pinned ? "sticky z-10 bg-white" : ""} px-2 py-2`}
                      tabIndex={0}
                    >
                      {renderCell(row, col)}
                    </td>
                  );
                })}

                <td className="px-2 py-2 text-xs">📷 {row.media_counts?.images || 0} | 🎥 {row.media_counts?.videos || 0} | 📄 {row.media_counts?.documents || 0}</td>
                <td className="px-2 py-2">
                  <span className={`rounded-full px-2 py-1 text-xs ${scoreColor(Number(row.completeness_score || 0))}`}>{Number(row.completeness_score || 0)}%</span>
                </td>
                <td className="px-2 py-2 text-xs text-slate-600">{relTime(String(row.updated_at || ""))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {infinite && <div ref={sentinelRef} className="h-6" />}
      </div>

      {!infinite && (
        <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs">
          <span>Page {page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">Prev</button>
            <button disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {showFilters && (
        <aside className="fixed inset-y-0 left-0 z-50 w-[360px] overflow-auto border-r border-slate-200 bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Advanced Filters</h3>
            <button onClick={() => setShowFilters(false)} className="text-sm text-slate-500">Close</button>
          </div>

          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Price min" value={filters.price?.min || ""} onChange={(e) => setFilters((p) => ({ ...p, price: { ...p.price, min: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
              <input placeholder="Price max" value={filters.price?.max || ""} onChange={(e) => setFilters((p) => ({ ...p, price: { ...p.price, max: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>
            <input placeholder="Currency" value={filters.currency || ""} onChange={(e) => setFilters((p) => ({ ...p, currency: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />

            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Size min" value={filters.size?.min || ""} onChange={(e) => setFilters((p) => ({ ...p, size: { ...p.size, min: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
              <input placeholder="Size max" value={filters.size?.max || ""} onChange={(e) => setFilters((p) => ({ ...p, size: { ...p.size, max: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Bedrooms min" value={filters.bedrooms?.min || ""} onChange={(e) => setFilters((p) => ({ ...p, bedrooms: { ...p.bedrooms, min: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
              <input placeholder="Bedrooms max" value={filters.bedrooms?.max || ""} onChange={(e) => setFilters((p) => ({ ...p, bedrooms: { ...p.bedrooms, max: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Bathrooms min" value={filters.bathrooms?.min || ""} onChange={(e) => setFilters((p) => ({ ...p, bathrooms: { ...p.bathrooms, min: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
              <input placeholder="Bathrooms max" value={filters.bathrooms?.max || ""} onChange={(e) => setFilters((p) => ({ ...p, bathrooms: { ...p.bathrooms, max: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>

            <input placeholder="Areas (comma separated)" value={(filters.areas || []).join(", ")} onChange={(e) => setFilters((p) => ({ ...p, areas: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
            <input placeholder="Compounds (comma separated)" value={(filters.compounds || []).join(", ")} onChange={(e) => setFilters((p) => ({ ...p, compounds: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />

            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Floor min" value={filters.floor?.min || ""} onChange={(e) => setFilters((p) => ({ ...p, floor: { ...p.floor, min: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
              <input placeholder="Floor max" value={filters.floor?.max || ""} onChange={(e) => setFilters((p) => ({ ...p, floor: { ...p.floor, max: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>

            <input placeholder="Furnished enum" value={filters.furnished || ""} onChange={(e) => setFilters((p) => ({ ...p, furnished: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
            <input placeholder="Finishing" value={filters.finishing || ""} onChange={(e) => setFilters((p) => ({ ...p, finishing: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
            <input placeholder="Payment terms" value={filters.payment_terms || ""} onChange={(e) => setFilters((p) => ({ ...p, payment_terms: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
            <input placeholder="Status" value={filters.status || ""} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
            <input placeholder="Source" value={filters.source || ""} onChange={(e) => setFilters((p) => ({ ...p, source: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />

            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Has media yes/no" value={filters.has_media || ""} onChange={(e) => setFilters((p) => ({ ...p, has_media: e.target.value as "yes" | "no" }))} className="rounded border border-slate-300 px-2 py-1.5" />
              <input placeholder="Min media count" value={filters.min_media_count || ""} onChange={(e) => setFilters((p) => ({ ...p, min_media_count: e.target.value }))} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={filters.created_from || ""} onChange={(e) => setFilters((p) => ({ ...p, created_from: e.target.value }))} className="rounded border border-slate-300 px-2 py-1.5" />
              <input type="date" value={filters.created_to || ""} onChange={(e) => setFilters((p) => ({ ...p, created_to: e.target.value }))} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={filters.updated_from || ""} onChange={(e) => setFilters((p) => ({ ...p, updated_from: e.target.value }))} className="rounded border border-slate-300 px-2 py-1.5" />
              <input type="date" value={filters.updated_to || ""} onChange={(e) => setFilters((p) => ({ ...p, updated_to: e.target.value }))} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>

            {type === "buyer" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input placeholder="Budget min" value={filters.budget?.min || ""} onChange={(e) => setFilters((p) => ({ ...p, budget: { ...p.budget, min: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
                  <input placeholder="Budget max" value={filters.budget?.max || ""} onChange={(e) => setFilters((p) => ({ ...p, budget: { ...p.budget, max: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
                </div>
                <input placeholder="Currency" value={filters.currency || ""} onChange={(e) => setFilters((p) => ({ ...p, currency: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Intent (buy/rent)" value={filters.intent || ""} onChange={(e) => setFilters((p) => ({ ...p, intent: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Preferred areas (comma separated)" value={(filters.preferred_areas || []).join(", ")} onChange={(e) => setFilters((p) => ({ ...p, preferred_areas: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Property type desired" value={filters.property_type || ""} onChange={(e) => setFilters((p) => ({ ...p, property_type: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Bedrooms needed (min)" value={filters.bedrooms_needed_min || ""} onChange={(e) => setFilters((p) => ({ ...p, bedrooms_needed_min: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Move timeline" value={filters.move_timeline || ""} onChange={(e) => setFilters((p) => ({ ...p, move_timeline: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Status" value={filters.status || ""} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={filters.last_contact_from || ""} onChange={(e) => setFilters((p) => ({ ...p, last_contact_from: e.target.value }))} className="rounded border border-slate-300 px-2 py-1.5" />
                  <input type="date" value={filters.last_contact_to || ""} onChange={(e) => setFilters((p) => ({ ...p, last_contact_to: e.target.value }))} className="rounded border border-slate-300 px-2 py-1.5" />
                </div>
                <input placeholder="Has requirements missing yes/no" value={filters.requirements_missing || ""} onChange={(e) => setFilters((p) => ({ ...p, requirements_missing: e.target.value as "yes" | "no" }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Source" value={filters.source || ""} onChange={(e) => setFilters((p) => ({ ...p, source: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
              </>
            )}

            {type === "client" && (
              <>
                <input placeholder="Client type" value={filters.client_type || ""} onChange={(e) => setFilters((p) => ({ ...p, client_type: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Area/City" value={filters.city_area || ""} onChange={(e) => setFilters((p) => ({ ...p, city_area: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Has active listings yes/no" value={filters.has_active_listings || ""} onChange={(e) => setFilters((p) => ({ ...p, has_active_listings: e.target.value as "yes" | "no" }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Phone exists yes/no" value={filters.phone_exists || ""} onChange={(e) => setFilters((p) => ({ ...p, phone_exists: e.target.value as "yes" | "no" }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Tags (comma separated)" value={(filters.tags || []).join(", ")} onChange={(e) => setFilters((p) => ({ ...p, tags: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <input placeholder="Source" value={filters.source || ""} onChange={(e) => setFilters((p) => ({ ...p, source: e.target.value }))} className="w-full rounded border border-slate-300 px-2 py-1.5" />
              </>
            )}

            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Completeness min" value={filters.completeness?.min || ""} onChange={(e) => setFilters((p) => ({ ...p, completeness: { ...p.completeness, min: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
              <input placeholder="Completeness max" value={filters.completeness?.max || ""} onChange={(e) => setFilters((p) => ({ ...p, completeness: { ...p.completeness, max: e.target.value } }))} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>

            <button onClick={() => setFilters({})} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">Clear filters</button>
          </div>
        </aside>
      )}

      {showIntakeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-lg font-semibold">New Intake</h3>
            <textarea value={newRawText} onChange={(e) => setNewRawText(e.target.value)} placeholder="Paste raw text" className="mt-3 h-32 w-full rounded border border-slate-300 p-3 text-sm" />
            <input type="file" multiple className="mt-2" onChange={(e) => setNewFiles(Array.from(e.target.files || []))} />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setShowIntakeModal(false)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
              <button onClick={createIntake} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">Create</button>
            </div>
          </div>
        </div>
      )}

      {drawer.open && (
        <aside className="fixed right-0 top-0 z-50 h-screen w-[460px] border-l border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="font-semibold">Record details</h3>
            <button onClick={() => setDrawer({ open: false, loading: false, data: null })} className="text-sm text-slate-500">Close</button>
          </div>
          <div className="h-[calc(100%-56px)] overflow-auto p-4">
            {drawer.loading && <p className="text-sm text-slate-500">Loading...</p>}
            {!drawer.loading && drawer.data && (
              <div className="space-y-4 text-sm">
                <div className="rounded border border-slate-200 p-3">
                  <h4 className="mb-2 font-semibold">Editable fields</h4>
                  {drawer.data.last_edited && (
                    <p className="mb-2 text-xs text-slate-500">Edited by {drawer.data.last_edited.by || "System"} at {relTime(drawer.data.last_edited.at)}</p>
                  )}
                  <div className="space-y-2">
                    {Object.entries(drawer.data.record || {}).slice(0, 12).map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[120px_1fr] gap-2">
                        <span className="text-xs text-slate-500">{k}</span>
                        <input defaultValue={String(v ?? "")} className="rounded border border-slate-300 px-2 py-1 text-xs" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-slate-200 p-3">
                  <h4 className="mb-2 font-semibold">Tasks</h4>

                  <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_140px_180px_auto]">
                    <input
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      placeholder="Create task (e.g. Call buyer)"
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                    <input value={taskDueDate} onChange={(e) => setTaskDueDate(e.target.value)} type="datetime-local" className="rounded border border-slate-300 px-2 py-1 text-xs" />
                    <select value={taskAssignedTo} onChange={(e) => setTaskAssignedTo(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                      <option value="">Assign user</option>
                      {(drawer.data.assignees || []).map((u: any) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    <button
                      disabled={isViewer}
                      onClick={() => createTask(relatedTypeFromGridType(type), drawer.data.record?.id)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
                    >
                      Add Task
                    </button>
                  </div>

                  <div className="space-y-2">
                    {(drawer.data.tasks || []).map((task: any) => (
                      <div key={task.id} className="rounded border border-slate-200 p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{task.title}</p>
                          <span className={`rounded px-2 py-0.5 ${task.status === "done" ? "bg-emerald-100 text-emerald-700" : task.status === "cancelled" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-700"}`}>{task.status}</span>
                        </div>
                        <p className="text-slate-500">Assigned: {task.assigned_to_name || "Unassigned"} • Due: {task.due_date ? relTime(task.due_date) : "-"}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button disabled={isViewer || task.status !== "open"} onClick={() => updateTask(task.id, { status: "done" })} className="rounded border border-slate-300 px-2 py-1 text-[10px] disabled:opacity-40">Mark done</button>
                          <input
                            type="datetime-local"
                            defaultValue={task.due_date ? new Date(task.due_date).toISOString().slice(0, 16) : ""}
                            onBlur={(e) => updateTask(task.id, { due_date: e.target.value || null })}
                            className="rounded border border-slate-300 px-2 py-1 text-[10px]"
                          />
                          <select defaultValue={task.assigned_to || ""} onChange={(e) => updateTask(task.id, { assigned_to: e.target.value || null })} className="rounded border border-slate-300 px-2 py-1 text-[10px]">
                            <option value="">Unassigned</option>
                            {(drawer.data.assignees || []).map((u: any) => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                    {(drawer.data.tasks || []).length === 0 && <p className="text-xs text-slate-500">No tasks yet.</p>}
                  </div>

                  {drawer.data.linked_contact?.id && (
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <p className="mb-2 text-xs font-semibold text-slate-600">Contact tasks</p>
                      <button disabled={isViewer} onClick={() => createTask("contact", drawer.data.linked_contact.id)} className="mb-2 rounded border border-slate-300 px-2 py-1 text-[10px] disabled:opacity-40">Add task to linked contact</button>
                      <div className="space-y-1">
                        {(drawer.data.contact_tasks || []).map((task: any) => (
                          <div key={task.id} className="rounded border border-slate-200 p-2 text-[10px]">
                            <p className="font-medium">{task.title}</p>
                            <p className="text-slate-500">{task.status} • {task.assigned_to_name || "Unassigned"}</p>
                          </div>
                        ))}
                        {(drawer.data.contact_tasks || []).length === 0 && <p className="text-[10px] text-slate-500">No contact tasks.</p>}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="font-semibold">Linked Contact</h4>
                    {drawer.data.linked_contact?.id && <span className="text-[10px] text-slate-500">{drawer.data.linked_contact.id.slice(0, 8)}</span>}
                  </div>

                  {drawer.data.linked_contact ? (
                    <div className="mb-2 rounded border border-slate-200 p-2 text-xs">
                      <p className="font-medium">{drawer.data.linked_contact.name || "Contact"}</p>
                      <p className="text-slate-500">{drawer.data.linked_contact.phone || "No phone"}</p>
                      <a href={`/clients?contact=${drawer.data.linked_contact.id}`} className="text-slate-400 underline">View contact</a>
                    </div>
                  ) : (
                    <p className="mb-2 text-xs text-slate-500">No linked contact</p>
                  )}

                  <div className="mb-2 flex gap-2">
                    <input
                      value={contactQuery}
                      onChange={(e) => setContactQuery(e.target.value)}
                      placeholder="Search contact by name/phone"
                      className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                    <button onClick={searchContacts} className="rounded border border-slate-300 px-2 py-1 text-xs">Search</button>
                  </div>

                  <div className="mb-2 space-y-1">
                    {contactMatches.map((contact) => (
                      <button disabled={isViewer} key={contact.id} onClick={() => linkContact(contact.id)} className="block w-full rounded border border-slate-200 px-2 py-1 text-left text-xs hover:bg-slate-50 disabled:opacity-40">
                        {contact.name || "Contact"} • {contact.phone || "No phone"}
                      </button>
                    ))}
                  </div>

                  <button disabled={isViewer} onClick={createContactFromDrawer} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">Create new contact manually</button>
                </div>

                {Array.isArray(drawer.data.linked_records) && drawer.data.linked_records.length > 0 && (
                  <div className="rounded border border-slate-200 p-3">
                    <h4 className="mb-2 font-semibold">Linked records</h4>
                    <div className="space-y-2">
                      {drawer.data.linked_records.map((item: any) => (
                        <div key={`${item.record_type}-${item.id}`} className="rounded border border-slate-200 p-2 text-xs">
                          <p className="font-medium">{item.record_type} • {item.code || item.id}</p>
                          <p className="text-slate-500">Status: {item.status || "-"} • Area: {item.area || "-"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded border border-slate-200 p-3">
                  <h4 className="mb-2 font-semibold">Media gallery</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {(drawer.data.media || []).slice(0, 12).map((m: any) => (
                      <a key={m.id} href={m.file_url} target="_blank" className="rounded bg-slate-100 p-2 text-xs" rel="noreferrer">
                        {m.media_type}
                      </a>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-slate-200 p-3">
                  <h4 className="mb-2 font-semibold">Timeline</h4>
                  <div className="space-y-2">
                    {(drawer.data.timeline || []).map((t: any) => (
                      <div key={t.id} className="rounded border border-slate-200 p-2">
                        <p className="font-medium">{t.action}</p>
                        <p className="text-xs text-slate-500">{relTime(t.created_at)}</p>
                      </div>
                    ))}
                  </div>
                </div>



                <div className="rounded border border-slate-200 p-3">
                  <h4 className="mb-2 font-semibold">History • Audit log</h4>
                  <div className="space-y-2">
                    {(drawer.data.audit_logs || []).map((a: any) => (
                      <div key={a.id} className="rounded border border-slate-200 p-2 text-xs">
                        <p className="font-medium">{a.action} • {a.actor_name || "System"}</p>
                        <p className="text-slate-500">{relTime(a.created_at)} • {a.source || "app"}</p>
                        <details>
                          <summary className="cursor-pointer text-slate-500">Diff</summary>
                          <pre className="mt-1 whitespace-pre-wrap text-[10px] text-slate-600">{JSON.stringify({ before: a.before_json, after: a.after_json }, null, 2)}</pre>
                        </details>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded border border-slate-300 px-2 py-1 text-xs">Open full record page</button>
                  <button
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                    onClick={() => navigator.clipboard.writeText(window.location.href)}
                  >
                    Copy share link
                  </button>
                  <button className="rounded border border-slate-300 px-2 py-1 text-xs">Create follow-up task</button>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
