"use client";

import Link from "next/link";
import { MediaManager } from "@/components/media/media-manager";
import { MediaSummary } from "@/components/media/media-summary";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type IntakeStatus = "draft" | "needs_review" | "confirmed";
type IntakeType = "sale" | "rent" | "buyer" | "client" | "other" | "";
type AiState = "idle" | "running" | "success" | "error";

type IntakeSessionRow = {
  id: string;
  status: IntakeStatus;
  created_at: string;
  type_detected: IntakeType;
  type_confirmed: IntakeType;
  raw_text: string;
  ai_json: Record<string, unknown>;
  ai_meta?: { detect_confidence?: number; extraction_error?: string; normalized_text?: string };
  confidence: number;
  completeness_score: number;
  media: Array<{ id: string; file_url: string; type: "image" | "video" | "document" | "other"; created_at: string }>;
  media_counts: { photos: number; videos: number; docs: number };
  source?: string;
};

function relativeTime(dateString: string) {
  const diff = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusClass(status: IntakeStatus) {
  if (status === "draft") return "bg-amber-100 text-amber-800";
  if (status === "needs_review") return "bg-blue-100 text-blue-800";
  return "bg-emerald-100 text-emerald-800";
}

function hasAiJson(row: IntakeSessionRow | null) {
  return !!row && Object.keys(row.ai_json || {}).length > 0;
}

function isAiStale(row: IntakeSessionRow | null) {
  if (!row) return false;
  return Boolean(row.ai_meta?.extraction_error) || !row.ai_meta?.normalized_text;
}

export default function InboxPage() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<IntakeSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IntakeSessionRow | null>(null);
  const [jumpToMedia, setJumpToMedia] = useState(false);
  const [aiStateById, setAiStateById] = useState<Record<string, AiState>>({});
  const [aiErrorById, setAiErrorById] = useState<Record<string, string>>({});

  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [hasMedia, setHasMedia] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [q, setQ] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [newRawText, setNewRawText] = useState("");
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    if (hasMedia) params.set("hasMedia", "true");
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (q) params.set("q", q);
    return params.toString();
  }, [status, type, hasMedia, startDate, endDate, q]);

  async function loadSessions(selectedId?: string) {
    setLoading(true);
    const res = await fetch(`/api/inbox/sessions?${query}`, { cache: "no-store" });
    const data = await res.json();
    const sessions: IntakeSessionRow[] = data.sessions || [];
    setRows(sessions);
    if (selectedId) {
      const matched = sessions.find((row) => row.id === selectedId) || null;
      setSelected(matched);
    } else if (selected) {
      const matched = sessions.find((row) => row.id === selected.id) || null;
      setSelected(matched);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (jumpToMedia && selected) {
      const node = document.getElementById("media-section");
      node?.scrollIntoView({ behavior: "smooth", block: "start" });
      setJumpToMedia(false);
    }
  }, [jumpToMedia, selected]);



  useEffect(() => {
    if (searchParams.get("quickCreate") === "1") setShowModal(true);
    const statusParam = searchParams.get("status");
    const typeParam = searchParams.get("type");
    const startParam = searchParams.get("startDate");
    const endParam = searchParams.get("endDate");
    const qParam = searchParams.get("q");
    if (statusParam) setStatus(statusParam);
    if (typeParam) setType(typeParam);
    if (startParam) setStartDate(startParam);
    if (endParam) setEndDate(endParam);
    if (qParam) setQ(qParam);
  }, [searchParams]);
  async function runAi(sessionId: string) {
    setAiStateById((prev) => ({ ...prev, [sessionId]: "running" }));
    setAiErrorById((prev) => ({ ...prev, [sessionId]: "" }));

    const res = await fetch("/api/ai/process-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intake_session_id: sessionId })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAiStateById((prev) => ({ ...prev, [sessionId]: "error" }));
      setAiErrorById((prev) => ({ ...prev, [sessionId]: data.error || "AI processing failed" }));
      return;
    }

    setAiStateById((prev) => ({ ...prev, [sessionId]: "success" }));
    await loadSessions(sessionId);
  }

  async function saveDraft() {
    if (!newRawText.trim()) return;
    setSaving(true);
    const form = new FormData();
    form.set("raw_text", newRawText);
    for (const file of newFiles) form.append("files", file);

    const res = await fetch("/api/inbox/sessions", { method: "POST", body: form });
    if (res.ok) {
      setShowModal(false);
      setNewRawText("");
      setNewFiles([]);
      await loadSessions();
    }
    setSaving(false);
  }

  const selectedAiState = selected ? aiStateById[selected.id] || "idle" : "idle";
  const selectedConfidence = selected ? Number(selected.confidence || 0) : 0;
  const canRunAi = !!selected && selected.status === "draft" && (!hasAiJson(selected) || isAiStale(selected));

  return (
    <section className="relative grid grid-cols-[1fr_430px] gap-4">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">Inbox Intake Sessions</h2>
          <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={() => setShowModal(true)}>
            New Intake
          </button>
        </div>

        <div className="grid grid-cols-6 gap-2 border-b border-slate-200 p-3">
          <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Status: All</option>
            <option value="draft">Draft</option>
            <option value="needs_review">Needs Review</option>
            <option value="confirmed">Confirmed</option>
          </select>

          <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Type: All</option>
            <option value="sale">Sale</option>
            <option value="rent">Rent</option>
            <option value="buyer">Buyer</option>
            <option value="client">Client</option>
            <option value="other">Other</option>
          </select>

          <label className="flex items-center gap-2 rounded border border-slate-300 px-2 py-1.5 text-sm">
            <input type="checkbox" checked={hasMedia} onChange={(e) => setHasMedia(e.target.checked)} />
            Has Media
          </label>

          <input type="date" className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input type="date" className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <input className="rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Search raw text / phone / code" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Detected Type</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Preview</th>
                <th className="px-3 py-2">Media</th>
                <th className="px-3 py-2">Completeness</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">No intake sessions yet.</td>
                </tr>
              )}

              {rows.map((row) => (
                <tr key={row.id} onClick={() => setSelected(row)} className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${selected?.id === row.id ? "bg-slate-50" : ""}`}>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(row.status)}`}>{row.status}</span></td>
                  <td className="px-3 py-2 text-slate-600">{relativeTime(row.created_at)}</td>
                  <td className="px-3 py-2 uppercase text-slate-700">{row.type_detected || "other"}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase text-slate-700">{row.source || "manual"}</span>
                  </td>
                  <td className="max-w-[420px] truncate px-3 py-2 text-slate-700">{row.raw_text.slice(0, 80)}</td>
                  <td className="px-3 py-2 text-slate-600">
                    <button className="rounded px-1 hover:bg-slate-100" onClick={(e) => { e.stopPropagation(); setSelected(row); setJumpToMedia(true); }}>
                      <MediaSummary items={row.media as never} />
                    </button>
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-700">{Number(row.completeness_score || 0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="sticky top-20 h-[78vh] overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {!selected && <p className="text-sm text-slate-500">Select a session to open its details drawer.</p>}
        {selected && (
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">AI Suggested Type</p>
              <p className="font-semibold uppercase">{selected.type_detected || "other"}</p>
              <p className="text-sm text-slate-600">Confidence: {selectedConfidence}%</p>
              <p className="text-xs text-slate-500">AI state: <span className="font-semibold">{selectedAiState}</span></p>
              {aiErrorById[selected.id] && <p className="mt-1 text-xs text-red-600">{aiErrorById[selected.id]}</p>}
              {canRunAi && (
                <button
                  onClick={() => runAi(selected.id)}
                  disabled={selectedAiState === "running"}
                  className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                >
                  {selectedAiState === "running" ? "Running AI..." : "Run AI"}
                </button>
              )}
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Raw Text</p>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{selected.raw_text}</pre>
            </div>

            <div id="media-section">
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Media Manager</p>
              <MediaManager intakeSessionId={selected.id} compact={false} />
            </div>

            <Link href={`/inbox/${selected.id}`} className="block w-full rounded-lg bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white">Review &amp; Confirm</Link>
          </div>
        )}
      </aside>

      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">New Intake</h3>
            <p className="mb-3 mt-1 text-sm text-slate-600">Paste messy Arabic/English text and upload related files.</p>

            <textarea className="h-40 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-slate-500" value={newRawText} onChange={(e) => setNewRawText(e.target.value)} placeholder="Paste raw intake text" />

            <label className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-400 p-5 text-sm text-slate-600">
              <span>Drag-drop files here or click to upload photos/videos/docs</span>
              <input type="file" multiple className="hidden" onChange={(e) => setNewFiles(Array.from(e.target.files || []))} />
            </label>

            <p className="mt-2 text-xs text-slate-500">Selected files: {newFiles.length}</p>

            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={saveDraft} disabled={saving || !newRawText.trim()}>
                {saving ? "Saving..." : "Save Draft"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
