"use client";

import Link from "next/link";
import { MediaManager } from "@/components/media/media-manager";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type ReviewType = "sale" | "rent" | "buyer" | "client" | "other";
type Mode = "create_new" | "update_existing";
type MergeMode = "keep_existing" | "replace_with_new" | "append";
type AiState = "idle" | "running" | "success" | "error";
type QuickQuestionType = "text" | "number" | "select" | "multiselect" | "phone";

type QuickQuestion = {
  key: string;
  label: string;
  type: QuickQuestionType;
  options?: string[];
};

type SessionDetail = {
  id: string;
  status: "draft" | "needs_review" | "confirmed";
  raw_text: string;
  type_detected: ReviewType | "";
  type_confirmed: string;
  ai_json: Record<string, unknown>;
  ai_meta?: { detect_confidence?: number; confidence_map?: Record<string, number>; remaining_critical_missing?: string[]; [k: string]: unknown };
  completeness_score: number;
};

type ExistingRow = { id: string; code?: string; source?: string; notes?: string; updated_at?: string };

const steps = ["Confirm Type", "Extracted Data Review", "New vs Existing", "Merge & Save"];

const fieldConfig: Record<Exclude<ReviewType, "other">, Array<{ key: string; aiKey?: string; label: string; numeric?: boolean; notes?: boolean }>> = {
  sale: [
    { key: "source", aiKey: "code", label: "Source" },
    { key: "price", label: "Price", numeric: true },
    { key: "currency", label: "Currency" },
    { key: "size_sqm", label: "Size (sqm)", numeric: true },
    { key: "bedrooms", label: "Bedrooms", numeric: true },
    { key: "bathrooms", label: "Bathrooms", numeric: true },
    { key: "area", aiKey: "location_area", label: "Area" },
    { key: "compound", label: "Compound" },
    { key: "floor", label: "Floor", numeric: true },
    { key: "furnished", label: "Furnished" },
    { key: "finishing", label: "Finishing" },
    { key: "payment_terms", label: "Payment Terms" },
    { key: "notes", label: "Notes", notes: true }
  ],
  rent: [
    { key: "source", aiKey: "code", label: "Source" },
    { key: "price", label: "Price", numeric: true },
    { key: "currency", label: "Currency" },
    { key: "size_sqm", label: "Size (sqm)", numeric: true },
    { key: "bedrooms", label: "Bedrooms", numeric: true },
    { key: "bathrooms", label: "Bathrooms", numeric: true },
    { key: "area", aiKey: "location_area", label: "Area" },
    { key: "compound", label: "Compound" },
    { key: "floor", label: "Floor", numeric: true },
    { key: "furnished", label: "Furnished" },
    { key: "finishing", label: "Finishing" },
    { key: "payment_terms", label: "Payment Terms" },
    { key: "notes", label: "Notes", notes: true }
  ],
  buyer: [
    { key: "source", aiKey: "code", label: "Source" },
    { key: "budget_min", label: "Budget Min", numeric: true },
    { key: "budget_max", label: "Budget Max", numeric: true },
    { key: "preferred_areas", label: "Preferred Areas (comma separated)" },
    { key: "bedrooms_needed", label: "Bedrooms Needed", numeric: true },
    { key: "timeline", aiKey: "move_timeline", label: "Timeline" },
    { key: "notes", label: "Notes", notes: true }
  ],
  client: [
    { key: "source", aiKey: "code", label: "Source" },
    { key: "name", label: "Name" },
    { key: "phone", label: "Phone" },
    { key: "role", aiKey: "client_type", label: "Role (owner/seller/landlord)" },
    { key: "notes", label: "Notes", notes: true }
  ]
};

function buildFormFromAi(type: ReviewType, ai: Record<string, unknown>) {
  if (type === "other") return {};
  const out: Record<string, string> = {};
  fieldConfig[type].forEach((f) => {
    const lookup = f.aiKey || f.key;
    const raw = ai[lookup] ?? ai[f.key];
    out[f.key] = Array.isArray(raw) ? raw.join(", ") : String(raw ?? "");
  });
  return out;
}

function confidenceUi(score: number) {
  if (score >= 80) return { label: "High", cls: "bg-emerald-100 text-emerald-800" };
  if (score >= 50) return { label: "Medium", cls: "bg-amber-100 text-amber-800" };
  return { label: "Low", cls: "bg-orange-100 text-orange-800" };
}

const defaultAreas = ["New Cairo", "Maadi", "Zamalek", "Sheikh Zayed", "October", "Nasr City"];

function recordPath(recordType: string) {
  if (recordType === "properties_sale") return "/sale-properties";
  if (recordType === "properties_rent") return "/rent-properties";
  if (recordType === "buyers") return "/buyers";
  if (recordType === "clients") return "/clients";
  return "/inbox";
}

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
}

export default function IntakeReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedType, setSelectedType] = useState<ReviewType>("other");
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirtyFields, setDirtyFields] = useState<Record<string, boolean>>({});
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiError, setAiError] = useState("");

  const [quickQuestions, setQuickQuestions] = useState<QuickQuestion[]>([]);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [skippedQuestions, setSkippedQuestions] = useState<Record<string, boolean>>({});

  const [mode, setMode] = useState<Mode>("create_new");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ExistingRow[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string>("");
  const [existingRecord, setExistingRecord] = useState<Record<string, unknown>>({});
  const [mergeDecisions, setMergeDecisions] = useState<Record<string, MergeMode>>({});
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState("");
  const [savedRecord, setSavedRecord] = useState<{ recordType: string; recordId: string } | null>(null);

  const fields = useMemo(() => {
    if (selectedType === "other") return [];
    return fieldConfig[selectedType];
  }, [selectedType]);

  const hasRemainingCritical = useMemo(() => {
    const remaining = (session?.ai_meta?.remaining_critical_missing || []) as string[];
    return remaining.length > 0 || Object.values(skippedQuestions).some(Boolean);
  }, [session?.ai_meta?.remaining_critical_missing, skippedQuestions]);

  async function loadSession() {
    setLoading(true);
    const res = await fetch(`/api/intake/${params.id}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setLoading(false);
      return;
    }

    const nextSession = data.session as SessionDetail;
    setSession(nextSession);
    setQuickQuestions((data.quick_questions || []) as QuickQuestion[]);

    const preselected = (nextSession.type_confirmed || nextSession.type_detected || "other") as ReviewType;
    setSelectedType(preselected);

    const aiJson = (nextSession.ai_json || {}) as Record<string, unknown>;
    if (Object.keys(aiJson).length > 0) {
      setForm((prev) => {
        const incoming = buildFormFromAi(preselected, aiJson);
        const next = { ...prev };
        Object.entries(incoming).forEach(([k, v]) => {
          if (!dirtyFields[k]) next[k] = v;
        });
        return next;
      });
    }

    if (Object.keys(aiJson).length === 0) {
      await runAi();
    } else {
      setAiState("success");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    if (mode !== "update_existing" || selectedType === "other") return;
    async function runSearch() {
      const res = await fetch(`/api/review/search?type=${selectedType}&q=${encodeURIComponent(search)}`, { cache: "no-store" });
      const data = await res.json();
      setResults(data.results || []);
    }
    runSearch();
  }, [mode, selectedType, search]);

  useEffect(() => {
    const defaults: Record<string, MergeMode> = {};
    fields.forEach((f) => {
      defaults[f.key] = f.notes ? "append" : "replace_with_new";
    });
    setMergeDecisions(defaults);
  }, [fields]);

  async function runAi() {
    if (!session && !params.id) return;
    setAiState("running");
    setAiError("");

    const res = await fetch("/api/ai/process-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intake_session_id: params.id })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setAiState("error");
      setAiError(data.error || "AI processing failed");
      return;
    }

    setAiState("success");
    const type = (data.detected_type || selectedType) as ReviewType;
    const aiJson = (data.normalized_json || {}) as Record<string, unknown>;

    setSelectedType((prev) => (prev === "other" ? type : prev));
    setForm((prev) => {
      const incoming = buildFormFromAi(type, aiJson);
      const next = { ...prev };
      Object.entries(incoming).forEach(([k, v]) => {
        if (!dirtyFields[k]) next[k] = v;
      });
      return next;
    });

    await loadSession();
  }

  async function rerunByForcedType(type: Exclude<ReviewType, "other">) {
    setAiState("running");
    setAiError("");

    const res = await fetch("/api/ai/extract-by-type", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intake_session_id: params.id, forced_type: type })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setAiState("error");
      setAiError(data.error || "Forced extraction failed");
      return;
    }

    const aiJson = (data.normalized_json || {}) as Record<string, unknown>;
    setAiState("success");
    setForm((prev) => {
      const incoming = buildFormFromAi(type, aiJson);
      const next = { ...prev };
      Object.entries(incoming).forEach(([k, v]) => {
        if (!dirtyFields[k]) next[k] = v;
      });
      return next;
    });

    await loadSession();
  }

  function applyQuestionAnswer(questionKey: string, value: string) {
    const normalizedValue = questionKey.includes("phone") ? normalizePhone(value) : value;
    setQuestionAnswers((prev) => ({ ...prev, [questionKey]: normalizedValue }));
    setSkippedQuestions((prev) => ({ ...prev, [questionKey]: false }));

    if (questionKey === "location_area") {
      setDirtyFields((prev) => ({ ...prev, area: true }));
      setForm((prev) => ({ ...prev, area: normalizedValue }));
      return;
    }

    if (questionKey === "client_type") {
      setDirtyFields((prev) => ({ ...prev, role: true }));
      setForm((prev) => ({ ...prev, role: normalizedValue }));
      return;
    }

    if (questionKey === "contact_phone") return;

    setDirtyFields((prev) => ({ ...prev, [questionKey]: true }));
    setForm((prev) => ({ ...prev, [questionKey]: normalizedValue }));
  }

  async function loadExistingRecord(recordId: string) {
    if (!recordId || selectedType === "other") return;
    const res = await fetch(`/api/review/search?type=${selectedType}&q=`);
    const data = await res.json();
    const row = (data.results || []).find((r: ExistingRow) => r.id === recordId);
    setExistingRecord(row || {});
  }

  async function saveConfirmation() {
    if (!session || selectedType === "other") return;
    if (session.status === "confirmed") {
      setSaveToast("This intake is already confirmed.");
      return;
    }

    setSaving(true);

    const payload = {
      intakeSessionId: session.id,
      type: selectedType,
      mode,
      selectedRecordId: mode === "update_existing" ? selectedRecordId : undefined,
      extractedData: form,
      mergeDecisions
    };

    const res = await fetch("/api/review/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));

    setSaving(false);
    if (!res.ok) {
      setSaveToast(data.error || "Save failed");
      return;
    }

    setSaveToast("Saved successfully");
    setSavedRecord({ recordType: data.recordType, recordId: data.recordId });
    setTimeout(() => {
      router.push("/inbox");
    }, 1200);
  }

  async function copyRawText() {
    if (!session?.raw_text) return;
    await navigator.clipboard.writeText(session.raw_text);
  }

  if (loading || !session) return <div className="rounded-xl border border-slate-200 bg-white p-6">Loading Intake Review...</div>;

  const detectConfidence = Number(session.ai_meta?.detect_confidence || 0);

  return (
    <div className="grid grid-cols-[1fr_360px] gap-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Intake Review</h1>
          <Link href="/inbox" className="text-sm text-slate-600 underline">Back to Inbox</Link>
        </div>

        {session.status === "confirmed" && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This intake is already confirmed. Saving is disabled to prevent double-confirm.
          </div>
        )}

        {hasRemainingCritical && (
          <div className="mb-4 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800">
            Needs Review: some critical fields are still missing.
          </div>
        )}

        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span>AI state:</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold uppercase">{aiState}</span>
            <span>Detected:</span>
            <span className="font-semibold uppercase">{session.type_detected || "other"}</span>
            <span>({detectConfidence}%)</span>
            <button onClick={runAi} disabled={aiState === "running"} className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
              {aiState === "running" ? "Running..." : "Run AI"}
            </button>
          </div>
          {aiError && <p className="mt-2 text-xs text-red-600">{aiError}</p>}
        </div>

        {quickQuestions.length > 0 && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <h3 className="text-sm font-semibold text-slate-800">Quick questions to finalize this intake</h3>
            <div className="mt-2 space-y-2">
              {quickQuestions.slice(0, 3).map((question) => (
                <div key={question.key} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  {question.type === "select" ? (
                    <select
                      value={questionAnswers[question.key] || ""}
                      onChange={(e) => applyQuestionAnswer(question.key, e.target.value)}
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">{question.label}</option>
                      {(question.options || []).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : question.type === "multiselect" ? (
                    <select
                      multiple
                      value={(questionAnswers[question.key] || "").split(",").map((v) => v.trim()).filter(Boolean)}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions).map((o) => o.value).join(", ");
                        applyQuestionAnswer(question.key, selected);
                      }}
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      {(question.options || defaultAreas).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={question.type === "number" ? "number" : "text"}
                      value={questionAnswers[question.key] || ""}
                      onChange={(e) => applyQuestionAnswer(question.key, e.target.value)}
                      placeholder={question.label}
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  )}
                  <button
                    onClick={() => setSkippedQuestions((prev) => ({ ...prev, [question.key]: true }))}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    Skip
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-6 grid grid-cols-4 gap-2">
          {steps.map((label, idx) => {
            const i = idx + 1;
            const active = i === step;
            const done = i < step;
            return <div key={label} className={`rounded-lg border px-3 py-2 text-sm ${active ? "border-slate-900 bg-slate-900 text-white" : done ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-600"}`}>{i}. {label}</div>;
          })}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">AI detected type: <strong>{session.type_detected || "other"}</strong></div>
            <p className="text-sm text-slate-600">Choose where to save this data. It will go to the correct sheet/grid and never mix with others.</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["sale", "Property for Sale"],
                ["rent", "Property for Rent"],
                ["buyer", "Buyer"],
                ["client", "Client/Owner"],
                ["other", "Other"]
              ] as Array<[ReviewType, string]>).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => {
                    setSelectedType(value);
                    if (value !== "other" && value !== session.type_detected) rerunByForcedType(value);
                  }}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${selectedType === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            {selectedType === "other" && <p className="text-sm text-slate-600">Select a type in Step 1 first.</p>}
            {fields.map((field) => {
              const value = form[field.key] || "";
              const rawConfidence = Number((session.ai_meta?.confidence_map || {})[field.aiKey || field.key] ?? 0.6) * 100;
              const ui = confidenceUi(rawConfidence);

              return (
                <div key={field.key} className="grid grid-cols-[200px_1fr_120px] items-center gap-3">
                  <label className="text-sm font-medium text-slate-700">{field.label}</label>
                  <input
                    value={value}
                    onChange={(e) => {
                      setDirtyFields((prev) => ({ ...prev, [field.key]: true }));
                      setForm((prev) => ({ ...prev, [field.key]: e.target.value }));
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <span className={`inline-flex justify-center rounded-full px-2 py-1 text-xs font-semibold ${ui.cls}`}>{ui.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">Is this a new record or update an existing one?</p>
            <div className="flex gap-2">
              <button className={`rounded-lg border px-3 py-2 text-sm ${mode === "create_new" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} onClick={() => setMode("create_new")}>Create New</button>
              <button className={`rounded-lg border px-3 py-2 text-sm ${mode === "update_existing" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} onClick={() => setMode("update_existing")}>Update Existing</button>
            </div>

            {mode === "update_existing" && selectedType !== "other" && (
              <>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${selectedType} records`} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-2">Select</th><th className="px-2 py-2">Code</th><th className="px-2 py-2">Source</th><th className="px-2 py-2">Notes</th></tr></thead>
                  <tbody>
                    {results.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="px-2 py-2"><input type="radio" name="selectedRecord" checked={selectedRecordId === row.id} onChange={() => { setSelectedRecordId(row.id); loadExistingRecord(row.id); }} /></td>
                        <td className="px-2 py-2">{row.code || row.id.slice(0, 8)}</td>
                        <td className="px-2 py-2">{row.source || "-"}</td>
                        <td className="max-w-[260px] truncate px-2 py-2">{row.notes || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            {mode === "create_new" && <p className="text-sm text-slate-700">A new <strong>{selectedType}</strong> record will be created from reviewed fields.</p>}
            {mode === "update_existing" && fields.map((field) => (
              <div key={field.key} className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-sm font-semibold text-slate-800">{field.label}</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded bg-slate-50 p-2"><p className="text-xs uppercase text-slate-500">Existing</p><p>{String(existingRecord[field.key] ?? "") || "-"}</p></div>
                  <div className="rounded bg-blue-50 p-2"><p className="text-xs uppercase text-slate-500">New Intake</p><p>{form[field.key] || "-"}</p></div>
                </div>
                <div className="mt-2 flex gap-2 text-xs">
                  {([
                    ["keep_existing", "Keep existing"],
                    ["replace_with_new", "Replace with new"],
                    ["append", "Append"]
                  ] as Array<[MergeMode, string]>).map(([value, label]) => (
                    <label key={value} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1">
                      <input type="radio" name={`merge-${field.key}`} checked={(mergeDecisions[field.key] || (field.notes ? "append" : "replace_with_new")) === value} onChange={() => setMergeDecisions((prev) => ({ ...prev, [field.key]: value }))} disabled={value === "append" && !field.notes} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <button disabled={saving || session.status === "confirmed" || (mode === "update_existing" && !selectedRecordId) || selectedType === "other"} onClick={saveConfirmation} className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? "Saving..." : "Save Confirmation"}
            </button>
          </div>
        )}

        <div className="mt-6 flex justify-between">
          <button onClick={() => setStep((s) => Math.max(1, s - 1))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Back</button>
          <button onClick={() => setStep((s) => Math.min(4, s + 1))} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">Next</button>
        </div>
      </section>

      {saveToast && (
        <div className="fixed bottom-4 right-4 z-40 w-[320px] rounded-lg border border-slate-300 bg-white p-3 shadow-lg">
          <p className="text-sm font-medium text-slate-800">{saveToast}</p>
          <div className="mt-2 flex gap-2">
            {savedRecord && (
              <Link href={`${recordPath(savedRecord.recordType)}?recordId=${savedRecord.recordId}`} className="rounded border border-slate-300 px-2 py-1 text-xs">
                Open record
              </Link>
            )}
            <button onClick={() => router.push('/inbox')} className="rounded bg-slate-900 px-2 py-1 text-xs text-white">Return to Inbox</button>
          </div>
        </div>
      )}

      <aside className="sticky top-20 h-[80vh] overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Raw Text Reference</h3>
          <button onClick={copyRawText} className="rounded border border-slate-300 px-2 py-1 text-xs">Copy</button>
        </div>
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{session.raw_text}</pre>

        <h4 className="mt-4 text-sm font-semibold text-slate-700">Media Manager</h4>
        <div className="mt-2">
          <MediaManager intakeSessionId={session.id} compact={false} />
        </div>
      </aside>
    </div>
  );
}
