"use client";

import { useMemo, useState } from "react";

type Dataset = "sale" | "rent" | "buyer" | "client";
type GroupBy = "area" | "compound" | "status" | "furnished" | "finishing" | "source" | "currency" | "preferred_area";
type Metric = "count" | "avg" | "min" | "max";
type TemplateId = "sale_by_area" | "rent_by_area" | "buyers_by_preferred_area" | "needs_review_breakdown";

type ReportResponse = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
};

const templates: Array<{ id: TemplateId; title: string; description: string }> = [
  { id: "sale_by_area", title: "Sale by Area", description: "Count + average price" },
  { id: "rent_by_area", title: "Rent by Area", description: "Count + average rent" },
  { id: "buyers_by_preferred_area", title: "Buyers by Preferred Area", description: "Count + average budget" },
  { id: "needs_review_breakdown", title: "Needs Review Breakdown", description: "Count by type + missing field" }
];

const groupByOptions: Array<{ value: GroupBy; label: string }> = [
  { value: "area", label: "Area" },
  { value: "compound", label: "Compound" },
  { value: "status", label: "Status" },
  { value: "furnished", label: "Furnished" },
  { value: "finishing", label: "Finishing" },
  { value: "source", label: "Source" },
  { value: "currency", label: "Currency" },
  { value: "preferred_area", label: "Preferred Area (buyers)" }
];

const metricOptions: Array<{ value: Metric; label: string }> = [
  { value: "count", label: "Count" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" }
];

export default function ReportsPage() {
  const [dataset, setDataset] = useState<Dataset>("sale");
  const [groupBy, setGroupBy] = useState<GroupBy>("area");
  const [metrics, setMetrics] = useState<Metric[]>(["count", "avg"]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [area, setArea] = useState("");
  const [status, setStatus] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [currencyMode, setCurrencyMode] = useState<"split" | "single">("split");
  const [currency, setCurrency] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReportResponse | null>(null);
  const [title, setTitle] = useState("Custom report");
  const [saved, setSaved] = useState<Array<{ id: string; name: string; payload: Record<string, unknown> }>>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem("crm-reports-saved") || "[]");
    } catch {
      return [];
    }
  });

  const payload = useMemo(
    () => ({
      dataset,
      groupBy,
      metrics,
      filters: {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        area: area || undefined,
        status: status || undefined,
        price_min: priceMin || undefined,
        price_max: priceMax || undefined,
        currency: currency || undefined
      },
      currency_mode: currencyMode,
      currency_target: currency || undefined
    }),
    [dataset, groupBy, metrics, dateFrom, dateTo, area, status, priceMin, priceMax, currencyMode, currency]
  );

  async function run(template?: TemplateId) {
    setLoading(true);
    const body = template ? { template } : payload;
    const res = await fetch("/api/reports/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    setResult(data);
    setLoading(false);
    if (template) {
      const t = templates.find((x) => x.id === template);
      setTitle(t?.title || "Report");
    } else {
      setTitle(`Custom: ${dataset} by ${groupBy}`);
    }
  }

  function toggleMetric(metric: Metric) {
    setMetrics((prev) => {
      if (prev.includes(metric)) return prev.filter((x) => x !== metric);
      return [...prev, metric];
    });
  }

  function saveReport() {
    const name = prompt("Report name", title) || "Saved report";
    const next = [{ id: `report_${Date.now()}`, name, payload }, ...saved].slice(0, 20);
    setSaved(next);
    localStorage.setItem("crm-reports-saved", JSON.stringify(next));
  }

  return (
    <section className="grid grid-cols-[360px_1fr] gap-4">
      <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Reports</h2>
          <p className="mt-1 text-xs text-slate-500">Lightweight pivot-style analytics builder.</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Templates</p>
          <div className="space-y-2">
            {templates.map((template) => (
              <button key={template.id} onClick={() => run(template.id)} className="w-full rounded-lg border border-slate-200 p-2 text-left hover:bg-slate-50">
                <p className="text-sm font-medium text-slate-800">{template.title}</p>
                <p className="text-xs text-slate-500">{template.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Custom builder</p>
          <div className="space-y-2 text-sm">
            <select value={dataset} onChange={(e) => setDataset(e.target.value as Dataset)} className="w-full rounded border border-slate-300 px-2 py-1.5">
              <option value="sale">Sale</option>
              <option value="rent">Rent</option>
              <option value="buyer">Buyers</option>
              <option value="client">Clients</option>
            </select>

            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="w-full rounded border border-slate-300 px-2 py-1.5">
              {groupByOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-2 rounded border border-slate-200 p-2">
              {metricOptions.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={metrics.includes(option.value)} onChange={() => toggleMetric(option.value)} />
                  {option.label}
                </label>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5" />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>
            <input placeholder="Area filter" value={area} onChange={(e) => setArea(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5" />
            <input placeholder="Status filter" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5" />
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Price/Budget min" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5" />
              <input placeholder="Price/Budget max" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={currencyMode} onChange={(e) => setCurrencyMode(e.target.value as "split" | "single")} className="rounded border border-slate-300 px-2 py-1.5">
                <option value="split">Split by currency</option>
                <option value="single">Single currency</option>
              </select>
              <input placeholder="Currency (optional)" value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => run()} disabled={loading} className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50">Run report</button>
              <button onClick={saveReport} className="rounded border border-slate-300 px-3 py-2">Save report</button>
            </div>
          </div>
        </div>

        {saved.length > 0 && (
          <div className="border-t border-slate-200 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Saved reports</p>
            <div className="space-y-1">
              {saved.map((item) => (
                <button
                  key={item.id}
                  onClick={async () => {
                    setLoading(true);
                    const res = await fetch("/api/reports/run", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(item.payload)
                    });
                    const data = await res.json();
                    setResult(data);
                    setTitle(item.name);
                    setLoading(false);
                  }}
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {loading && <span className="text-xs text-slate-500">Running…</span>}
        </div>

        {!result && <p className="text-sm text-slate-500">Run a template or build a custom report.</p>}

        {result && (
          <div className="overflow-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                <tr>
                  {result.columns.filter((c) => c !== "drilldown_href").map((col) => <th key={col} className="px-3 py-2">{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    onClick={() => {
                      const href = String(row.drilldown_href || "");
                      if (href) window.location.assign(href);
                    }}
                  >
                    {result.columns.filter((c) => c !== "drilldown_href").map((col) => <td key={col} className="px-3 py-2">{String(row[col] ?? "-")}</td>)}
                  </tr>
                ))}
                {!result.rows.length && (
                  <tr>
                    <td className="px-3 py-8 text-center text-slate-500" colSpan={Math.max(1, result.columns.length - 1)}>No rows</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
