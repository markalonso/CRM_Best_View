"use client";

import { useState } from "react";

type Dataset = "sale" | "rent" | "buyer" | "client";

type PreviewState = {
  headers: string[];
  sampleRows: string[][];
};

const datasetFields: Record<Dataset, string[]> = {
  sale: ["code", "source", "price", "currency", "size_sqm", "bedrooms", "bathrooms", "area", "compound", "floor", "furnished", "finishing", "payment_terms", "notes", "status"],
  rent: ["code", "source", "price", "currency", "size_sqm", "bedrooms", "bathrooms", "area", "compound", "floor", "furnished", "finishing", "payment_terms", "notes", "status"],
  buyer: ["code", "source", "phone", "currency", "intent", "property_type", "budget_min", "budget_max", "preferred_areas", "bedrooms_needed", "timeline", "notes", "status"],
  client: ["code", "source", "name", "phone", "role", "area", "tags", "status"]
};

export default function GoogleSheetsIntegrationPage() {
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [tabName, setTabName] = useState("Sale");
  const [dataset, setDataset] = useState<Dataset>("sale");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");

  async function loadPreview() {
    setMessage("Loading preview...");
    const res = await fetch("/api/integrations/sheets/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spreadsheet_id: spreadsheetId, tab: tabName })
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Preview failed");
      return;
    }
    setPreview({ headers: data.headers || [], sampleRows: data.sampleRows || [] });
    const nextMap: Record<string, string> = {};
    (data.headers || []).forEach((h: string) => {
      const exact = datasetFields[dataset].find((f) => f.toLowerCase() === h.toLowerCase());
      if (exact) nextMap[h] = exact;
    });
    setMapping(nextMap);
    setMessage("Preview loaded");
  }

  async function runImport() {
    setMessage("Importing rows into Inbox...");
    const res = await fetch("/api/integrations/sheets/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spreadsheet_id: spreadsheetId,
        mappings: [{ dataset, tab: tabName, column_map: mapping }]
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Import failed");
      return;
    }
    setMessage(`Imported ${data.created_count || 0} rows as intake sessions`);
  }

  async function syncNow() {
    setSyncMessage("Running sync...");
    const datasets: Dataset[] = ["sale", "rent", "buyer", "client"];
    const payloads: Array<{ dataset: Dataset; rows: Array<Record<string, unknown>> }> = [];

    for (const d of datasets) {
      const res = await fetch(`/api/grid/records?type=${d}&page=1&pageSize=3000&sort=updated_at:desc&filters=${encodeURIComponent("{}")}`, { cache: "no-store" });
      const data = await res.json();
      payloads.push({ dataset: d, rows: data.rows || [] });
    }

    const syncRes = await fetch("/api/integrations/sheets/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spreadsheet_id: spreadsheetId, payloads })
    });
    const syncData = await syncRes.json();
    if (!syncRes.ok) {
      setSyncMessage(syncData.error || "Sync failed");
      return;
    }
    setSyncMessage("Sync complete");
  }

  return (
    <section className="grid grid-cols-[420px_1fr] gap-4">
      <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Google Sheets Import</h2>
        <p className="text-xs text-slate-500">Map sheet columns into intake drafts for safe review-first ingestion.</p>

        <input
          value={spreadsheetId}
          onChange={(e) => setSpreadsheetId(e.target.value)}
          placeholder="Paste Google Sheet URL or ID"
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />

        <input value={tabName} onChange={(e) => setTabName(e.target.value)} placeholder="Tab name (e.g. Sale)" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />

        <select value={dataset} onChange={(e) => setDataset(e.target.value as Dataset)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
          <option value="sale">Sale</option>
          <option value="rent">Rent</option>
          <option value="buyer">Buyers</option>
          <option value="client">Clients</option>
        </select>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={loadPreview} className="rounded border border-slate-300 px-3 py-2 text-sm">Load columns</button>
          <button onClick={runImport} className="rounded bg-slate-900 px-3 py-2 text-sm text-white">Import to Inbox</button>
        </div>

        <button onClick={syncNow} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">Sync Now (manual export)</button>

        {message && <p className="text-xs text-slate-600">{message}</p>}
        {syncMessage && <p className="text-xs text-slate-600">{syncMessage}</p>}
      </aside>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {!preview && <p className="text-sm text-slate-500">Load preview to map columns.</p>}
        {preview && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Column Mapping</h3>
              <div className="mt-2 space-y-2">
                {preview.headers.map((header) => (
                  <div key={header} className="grid grid-cols-[1fr_1fr] gap-2 text-sm">
                    <div className="rounded border border-slate-200 px-2 py-1.5 text-slate-700">{header}</div>
                    <select
                      value={mapping[header] || ""}
                      onChange={(e) => setMapping((prev) => ({ ...prev, [header]: e.target.value }))}
                      className="rounded border border-slate-300 px-2 py-1.5"
                    >
                      <option value="">Ignore</option>
                      {datasetFields[dataset].map((field) => (
                        <option key={field} value={field}>{field}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold">Sample Rows</h3>
              <div className="mt-2 overflow-auto">
                <table className="w-full min-w-[700px] text-xs">
                  <thead className="bg-slate-50">
                    <tr>{preview.headers.map((h) => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row, idx) => (
                      <tr key={idx} className="border-t border-slate-100">{preview.headers.map((_, i) => <td key={i} className="px-2 py-1">{row[i] || ""}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
