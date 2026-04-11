"use client";

import Link from "next/link";
import { fetchFieldDefinitionsApi } from "@/services/api/hierarchy-api.service";
import { MediaManager } from "@/components/media/media-manager";
import { HierarchyPathSelector } from "@/components/hierarchy/hierarchy-path-selector";
import { useAuth } from "@/hooks/use-auth";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatFieldValueForInput,
  isFieldValueEmpty,
  parseFieldInputValue,
  resolveAiValueForField,
  reviewTypeToHierarchyFamily
} from "@/lib/effective-fields";
import type { EffectiveFieldDefinition, HierarchyNode } from "@/types/hierarchy";

type ReviewType = "sale" | "rent" | "buyer" | "client" | "other";
type Mode = "create_new" | "update_existing" | "";
type MergeMode = "keep_existing" | "replace_with_new" | "append";
type AiState = "idle" | "running" | "success" | "error";
type QuickQuestionType = "text" | "number" | "select" | "multiselect" | "phone";

type QuickQuestion = {
  key: string;
  label: string;
  type: QuickQuestionType;
  options?: string[];
};

type LegacyReviewField = {
  key: string;
  aiKey?: string;
  label: string;
  numeric?: boolean;
  notes?: boolean;
};

type SessionDetail = {
  id: string;
  status: "draft" | "needs_review" | "confirmed";
  raw_text: string;
  type_detected: ReviewType | "";
  type_confirmed: string;
  ai_json: Record<string, unknown>;
  ai_meta?: {
    detect_confidence?: number;
    confidence_map?: Record<string, number>;
    remaining_critical_missing?: string[];
    hierarchy_node_id?: string | null;
    media_folder_name?: string | null;
    media_hierarchy_node_id?: string | null;
    quick_question_state?: {
      questionAnswers?: Record<string, string>;
      skippedQuestions?: Record<string, boolean>;
      updatedAt?: string;
    };
    [k: string]: unknown;
  };
  completeness_score: number;
};

type ExistingRow = { id: string; code?: string; source?: string; notes?: string; updated_at?: string };

type FieldErrorMap = Record<string, string>;

const steps = ["Type & Hierarchy", "Extracted Data Review", "New vs Existing", "Merge & Save"];

const fieldConfig: Record<Exclude<ReviewType, "other">, LegacyReviewField[]> = {
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

function fieldValueKey(field: EffectiveFieldDefinition) {
  return field.storage_kind === "core_column" ? field.core_column_name || field.field_key : field.field_key;
}

function isAppendOnlyField(fieldKey: string) {
  return fieldKey === "notes";
}

function reviewTypeToGridType(type: Exclude<ReviewType, "other">) {
  if (type === "sale") return "sale";
  if (type === "rent") return "rent";
  if (type === "buyer") return "buyer";
  return "client";
}

function normalizeOptions(field: EffectiveFieldDefinition) {
  const rawOptions = field.effective_options_json;
  const directOptions = Array.isArray(rawOptions["options"]) ? rawOptions["options"] : Array.isArray(rawOptions["values"]) ? rawOptions["values"] : null;
  if (!directOptions) return [];
  return directOptions.map((option) => String(option)).filter(Boolean);
}

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
  const { user } = useAuth();
  const isAdmin = (user?.role || "viewer") === "admin";

  const [step, setStep] = useState(1);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedType, setSelectedType] = useState<ReviewType>("other");
  const [hierarchyNodeId, setHierarchyNodeId] = useState("");
  const [hierarchyValidation, setHierarchyValidation] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirtyFields, setDirtyFields] = useState<Record<string, boolean>>({});
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiError, setAiError] = useState("");

  const [quickQuestions, setQuickQuestions] = useState<QuickQuestion[]>([]);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
  const [skippedQuestions, setSkippedQuestions] = useState<Record<string, boolean>>({});
  const quickQuestionPersistRef = useRef("");

  const [mode, setMode] = useState<Mode>("");
  const [modeValidation, setModeValidation] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ExistingRow[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string>("");
  const [existingRecord, setExistingRecord] = useState<Record<string, unknown>>({});
  const [mergeDecisions, setMergeDecisions] = useState<Record<string, MergeMode>>({});
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState("");
  const [savedRecord, setSavedRecord] = useState<{ recordType: string; recordId: string } | null>(null);
  const [mediaCount, setMediaCount] = useState(0);
  const [mediaFolderName, setMediaFolderName] = useState("");
  const [mediaFolderValidation, setMediaFolderValidation] = useState("");
  const [effectiveFields, setEffectiveFields] = useState<EffectiveFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [customFieldDirty, setCustomFieldDirty] = useState<Record<string, boolean>>({});
  const [fieldValidationErrors, setFieldValidationErrors] = useState<FieldErrorMap>({});
  const [fieldLoadError, setFieldLoadError] = useState("");
  const [selectedHierarchySummary, setSelectedHierarchySummary] = useState<{ name: string; path: string; nodeKind: string } | null>(null);

  const legacyFields = useMemo(() => {
    if (selectedType === "other") return [];
    return fieldConfig[selectedType];
  }, [selectedType]);

  const criticalMissingKeys = useMemo(() => {
    const remainingCritical = (session?.ai_meta?.remaining_critical_missing || []) as string[];
    const missingFields = (session?.ai_meta?.missing_fields || []) as string[];
    const source = remainingCritical.length > 0 ? remainingCritical : missingFields;
    return source.map((value) => String(value));
  }, [session?.ai_meta?.missing_fields, session?.ai_meta?.remaining_critical_missing]);
  const hasRemainingCritical = useMemo(
    () => criticalMissingKeys.some((key) => !questionAnswers[key] && !skippedQuestions[key]),
    [criticalMissingKeys, questionAnswers, skippedQuestions]
  );
  const visibleQuickQuestions = useMemo(
    () => quickQuestions.filter((question) => !skippedQuestions[question.key] && !questionAnswers[question.key]),
    [quickQuestions, questionAnswers, skippedQuestions]
  );
  const hasUploadedMedia = mediaCount > 0;
  const hierarchyFamily = useMemo(() => reviewTypeToHierarchyFamily(selectedType), [selectedType]);
  const intakeFields = useMemo(
    () => effectiveFields.filter((field) => field.effective_visible && field.effective_intake_visible),
    [effectiveFields]
  );
  const mergeableCoreFields = useMemo(() => {
    if (selectedType === "other") return [] as Array<Pick<EffectiveFieldDefinition, "id" | "field_key" | "effective_label"> & { valueKey: string; notes: boolean }>;
    if (effectiveFields.length > 0) {
      return intakeFields
        .filter((field) => field.storage_kind === "core_column")
        .map((field) => {
          const valueKey = fieldValueKey(field);
          return {
            id: field.id,
            field_key: field.field_key,
            effective_label: field.effective_label,
            valueKey,
            notes: isAppendOnlyField(valueKey)
          };
        });
    }

    return legacyFields.map((field) => ({
      id: field.key,
      field_key: field.key,
      effective_label: field.label,
      valueKey: field.key,
      notes: Boolean(field.notes)
    }));
  }, [effectiveFields.length, intakeFields, legacyFields, selectedType]);

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
    setMediaCount(Array.isArray(data.media) ? data.media.length : 0);
    const hydratedAnswers = (nextSession.ai_meta?.quick_question_state?.questionAnswers || {}) as Record<string, string>;
    setQuestionAnswers(hydratedAnswers);
    setQuestionDrafts(hydratedAnswers);
    setSkippedQuestions((nextSession.ai_meta?.quick_question_state?.skippedQuestions || {}) as Record<string, boolean>);

    const preselected = (nextSession.type_confirmed || nextSession.type_detected || "other") as ReviewType;
    setSelectedType(preselected);
    setHierarchyNodeId((current) => String(nextSession.ai_meta?.hierarchy_node_id || current || ""));
    setMediaFolderName((current) => String(nextSession.ai_meta?.media_folder_name || current || ""));

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
    if (mode !== "update_existing") {
      setSearch("");
      setResults([]);
      setSelectedRecordId("");
      setExistingRecord({});
    }
  }, [mode]);

  useEffect(() => {
    const defaults: Record<string, MergeMode> = {};
    mergeableCoreFields.forEach((field) => {
      defaults[field.valueKey] = field.notes ? "append" : "replace_with_new";
    });
    setMergeDecisions(defaults);
  }, [mergeableCoreFields]);

  useEffect(() => {
    setHierarchyValidation("");
    setFieldValidationErrors({});
    setSelectedRecordId("");
    setExistingRecord({});
    if (selectedType === "other") {
      setHierarchyNodeId("");
      setEffectiveFields([]);
    }
  }, [selectedType]);

  useEffect(() => {
    if (!hasUploadedMedia) {
      setMediaFolderValidation("");
    }
  }, [hasUploadedMedia]);

  useEffect(() => {
    let active = true;

    async function loadEffectiveFields() {
      if (!hierarchyFamily) {
        if (active) {
          setEffectiveFields([]);
          setFieldLoadError("");
        }
        return;
      }

      try {
        const result = await fetchFieldDefinitionsApi(hierarchyFamily, hierarchyNodeId || undefined);
        if (!active) return;
        setEffectiveFields(result.fields || []);
        setFieldLoadError("");
      } catch (loadError) {
        if (!active) return;
        setEffectiveFields([]);
        setFieldLoadError(loadError instanceof Error ? loadError.message : "Failed to load node field configuration.");
      }
    }

    loadEffectiveFields();
    return () => {
      active = false;
    };
  }, [hierarchyFamily, hierarchyNodeId]);

  useEffect(() => {
    if (!session || effectiveFields.length === 0) return;

    const aiJson = (session.ai_json || {}) as Record<string, unknown>;

    setForm((prev) => {
      const next = { ...prev };
      effectiveFields.forEach((field) => {
        if (field.storage_kind !== "core_column") return;
        const key = fieldValueKey(field);
        if (dirtyFields[key]) return;
        const resolved = resolveAiValueForField(field, aiJson);
        next[key] = formatFieldValueForInput(resolved);
      });
      return next;
    });

    setCustomFieldValues((prev) => {
      const next = { ...prev };
      effectiveFields.forEach((field) => {
        if (field.storage_kind !== "custom_value" || customFieldDirty[field.field_key]) return;
        const resolved = resolveAiValueForField(field, aiJson);
        next[field.field_key] = formatFieldValueForInput(resolved);
      });
      return next;
    });
  }, [customFieldDirty, dirtyFields, effectiveFields, session]);

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
    setHierarchyNodeId("");
    setHierarchyValidation("");

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

  async function persistQuickQuestionState(nextAnswers: Record<string, string>, nextSkipped: Record<string, boolean>) {
    if (!session?.id) return;
    const snapshot = JSON.stringify({ questionAnswers: nextAnswers, skippedQuestions: nextSkipped });
    if (quickQuestionPersistRef.current === snapshot) return;
    quickQuestionPersistRef.current = snapshot;
    await fetch(`/api/intake/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionAnswers: nextAnswers,
        skippedQuestions: nextSkipped
      })
    }).catch(() => null);
  }

  function buildQuestionCommit(
    questionKey: string,
    value: string,
    currentAnswers: Record<string, string>,
    currentSkipped: Record<string, boolean>
  ) {
    const normalizedValue = questionKey.includes("phone") ? normalizePhone(value.trim()) : value.trim();
    if (!normalizedValue) return null;
    const nextAnswers = { ...currentAnswers, [questionKey]: normalizedValue };
    const nextSkipped = { ...currentSkipped, [questionKey]: false };
    const questionFieldAliases: Record<string, string[]> = {
      location_area: ["area", "location_area"],
      client_type: ["role", "client_type"],
      contact_phone: ["phone", "contact_phone"],
      preferred_areas: ["preferred_areas"],
      budget_max: ["budget_max"],
      budget_min: ["budget_min"],
      price: ["price"],
      phone: ["phone", "contact_phone"]
    };

    const candidates = questionFieldAliases[questionKey] || [questionKey];
    const targetField = effectiveFields.find((field) => {
      const key = fieldValueKey(field);
      return candidates.includes(key) || candidates.includes(field.field_key);
    });
    const fallbackKey = candidates[0];
    const targetKey = targetField ? fieldValueKey(targetField) : fallbackKey;

    return { normalizedValue, nextAnswers, nextSkipped, targetField, targetKey };
  }

  function applyQuestionAnswer(questionKey: string, value: string, options?: { persist?: boolean }) {
    const committed = buildQuestionCommit(questionKey, value, questionAnswers, skippedQuestions);
    if (!committed) return;
    const { normalizedValue, nextAnswers, nextSkipped, targetField, targetKey } = committed;
    setQuestionAnswers(nextAnswers);
    setQuestionDrafts((prev) => ({ ...prev, [questionKey]: normalizedValue }));
    setSkippedQuestions(nextSkipped);
    if (options?.persist !== false) {
      void persistQuickQuestionState(nextAnswers, nextSkipped);
    }

    if (targetField?.storage_kind === "custom_value") {
      setCustomFieldDirty((prev) => ({ ...prev, [targetField.field_key]: true }));
      setCustomFieldValues((prev) => ({ ...prev, [targetField.field_key]: normalizedValue }));
      return;
    }

    setDirtyFields((prev) => ({ ...prev, [targetKey]: true }));
    setForm((prev) => ({ ...prev, [targetKey]: normalizedValue }));
  }

  function commitQuestionDraft(questionKey: string) {
    const draftValue = questionDrafts[questionKey] || "";
    applyQuestionAnswer(questionKey, draftValue);
  }

  function commitPendingQuestionDrafts() {
    let nextAnswers = { ...questionAnswers };
    let nextSkipped = { ...skippedQuestions };
    let changed = false;
    const coreUpdates: Record<string, string> = {};
    const customUpdates: Record<string, string> = {};
    const nextCustomDirty: Record<string, boolean> = {};
    const nextDirty: Record<string, boolean> = {};

    quickQuestions.forEach((question) => {
      if (nextSkipped[question.key]) return;
      const draft = (questionDrafts[question.key] || "").trim();
      if (!draft) return;
      const committed = buildQuestionCommit(question.key, draft, nextAnswers, nextSkipped);
      if (!committed) return;
      const { normalizedValue, nextAnswers: computedAnswers, nextSkipped: computedSkipped, targetField, targetKey } = committed;
      if (nextAnswers[question.key] === normalizedValue && nextSkipped[question.key] === false) return;

      nextAnswers = computedAnswers;
      nextSkipped = computedSkipped;
      if (targetField?.storage_kind === "custom_value") {
        customUpdates[targetField.field_key] = normalizedValue;
        nextCustomDirty[targetField.field_key] = true;
      } else {
        coreUpdates[targetKey] = normalizedValue;
        nextDirty[targetKey] = true;
      }
      changed = true;
    });

    if (changed) {
      setQuestionAnswers(nextAnswers);
      setQuestionDrafts((prev) => ({ ...prev, ...nextAnswers }));
      setSkippedQuestions(nextSkipped);
      if (Object.keys(coreUpdates).length > 0) {
        setDirtyFields((prev) => ({ ...prev, ...nextDirty }));
        setForm((prev) => ({ ...prev, ...coreUpdates }));
      }
      if (Object.keys(customUpdates).length > 0) {
        setCustomFieldDirty((prev) => ({ ...prev, ...nextCustomDirty }));
        setCustomFieldValues((prev) => ({ ...prev, ...customUpdates }));
      }
      void persistQuickQuestionState(nextAnswers, nextSkipped);
    }
  }

  function handleSkipQuestion(questionKey: string) {
    const nextSkipped = { ...skippedQuestions, [questionKey]: true };
    setSkippedQuestions(nextSkipped);
    void persistQuickQuestionState(questionAnswers, nextSkipped);
  }

  async function loadExistingRecord(recordId: string) {
    if (!recordId || selectedType === "other") return;
    const type = reviewTypeToGridType(selectedType);
    const query = new URLSearchParams({ type, id: recordId });
    if (hierarchyNodeId) query.set("nodeId", hierarchyNodeId);
    const res = await fetch(`/api/grid/record-detail?${query.toString()}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setExistingRecord({});
      return;
    }
    setExistingRecord((data.field_values || data.record || {}) as Record<string, unknown>);
  }

  const handleHierarchyChange = useCallback((nodeId: string) => {
    setHierarchyNodeId(nodeId);
    setExistingRecord({});
    setFieldValidationErrors({});
    if (nodeId) setHierarchyValidation("");
  }, []);

  function handleFieldValueChange(field: EffectiveFieldDefinition, value: string) {
    const key = fieldValueKey(field);
    if (field.storage_kind === "core_column") {
      setDirtyFields((prev) => ({ ...prev, [key]: true }));
      setForm((prev) => ({ ...prev, [key]: value }));
    } else {
      setCustomFieldDirty((prev) => ({ ...prev, [field.field_key]: true }));
      setCustomFieldValues((prev) => ({ ...prev, [field.field_key]: value }));
    }

    setFieldValidationErrors((prev) => {
      if (!prev[key] && !prev[field.field_key]) return prev;
      const next = { ...prev };
      delete next[key];
      delete next[field.field_key];
      return next;
    });
  }

  function isHierarchyErrorMessage(message: string) {
    const normalized = message.toLowerCase();
    return normalized.includes("hierarchy") || normalized.includes("destination") || normalized.includes("root node") || normalized.includes("container-only") || normalized.includes("archived");
  }

  function validateMediaFolderName() {
    if (!hasUploadedMedia) return true;
    if (mediaFolderName.trim()) {
      setMediaFolderValidation("");
      return true;
    }
    setMediaFolderValidation("Enter a media folder name before continuing because this intake includes uploaded media.");
    return false;
  }

  function validateDynamicFields() {
    const nextErrors: FieldErrorMap = {};

    intakeFields.forEach((field) => {
      if (!field.effective_required) return;
      const key = fieldValueKey(field);
      const rawValue = field.storage_kind === "core_column" ? form[key] : customFieldValues[field.field_key];
      const parsedValue = field.storage_kind === "custom_value" ? parseFieldInputValue(field, rawValue) : rawValue;
      if (isFieldValueEmpty(parsedValue)) {
        nextErrors[key] = `${field.effective_label} is required for this hierarchy path.`;
      }
    });

    setFieldValidationErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleNextStep() {
    if (step === 1) {
      commitPendingQuestionDrafts();
    }
    if (step === 1 && selectedType !== "other" && !hierarchyNodeId) {
      setHierarchyValidation("Choose a hierarchy path before continuing to the extracted data review.");
      return;
    }
    if (step === 1 && selectedType !== "other" && !validateMediaFolderName()) {
      return;
    }
    if (step === 2 && selectedType !== "other" && !validateDynamicFields()) {
      return;
    }
    if (step === 3 && !mode) {
      setModeValidation("Choose whether to create a new record or update an existing one.");
      return;
    }
    if (step === 3 && mode === "update_existing" && !selectedRecordId) {
      setModeValidation("Select an existing record before continuing.");
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  }

  const handleHierarchySelectionChange = useCallback((node: HierarchyNode | null) => {
    if (!node) {
      setSelectedHierarchySummary((prev) => (prev === null ? prev : null));
      return;
    }
    setSelectedHierarchySummary((prev) => {
      const next = { name: node.name, path: node.path_text, nodeKind: node.node_kind };
      if (prev && prev.name === next.name && prev.path === next.path && prev.nodeKind === next.nodeKind) return prev;
      return next;
    });
  }, []);

  async function saveConfirmation() {
    if (!session || selectedType === "other") return;
    if (!mode) {
      setStep(3);
      setModeValidation("Choose whether to create a new record or update an existing one.");
      return;
    }
    if (session.status === "confirmed") {
      setSaveToast("This intake is already confirmed.");
      return;
    }
    if (!hierarchyNodeId) {
      setHierarchyValidation("Choose a hierarchy path before saving this intake.");
      setStep(1);
      setSaveToast("Select a hierarchy path before saving.");
      return;
    }
    if (!validateMediaFolderName()) {
      setStep(1);
      setSaveToast("Add a media folder name before saving this intake.");
      return;
    }
    if (!validateDynamicFields()) {
      setStep(2);
      setSaveToast("Complete the required hierarchy fields before saving this intake.");
      return;
    }

    setSaving(true);

    const dynamicCustomFieldValues = intakeFields
      .filter((field) => field.storage_kind === "custom_value")
      .map((field) => ({
        fieldKey: field.field_key,
        value: parseFieldInputValue(field, customFieldValues[field.field_key] ?? "")
      }))
      .filter((entry) => !isFieldValueEmpty(entry.value));

    const payload = {
      intakeSessionId: session.id,
      type: selectedType,
      mode: mode as Exclude<Mode, "">,
      selectedRecordId: mode === "update_existing" ? selectedRecordId : undefined,
      extractedData: form,
      mergeDecisions,
      hierarchyNodeId,
      mediaFolderName: hasUploadedMedia ? mediaFolderName.trim() : undefined,
      customFieldValues: dynamicCustomFieldValues
    };

    const res = await fetch("/api/review/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));

    setSaving(false);
    if (!res.ok) {
      const message = data.error || "Save failed";
      if (typeof message === "string" && isHierarchyErrorMessage(message)) {
        setHierarchyValidation(message);
        setStep(1);
      }
      if (typeof message === "string" && message.toLowerCase().includes("media folder")) {
        setMediaFolderValidation(message);
        setStep(1);
      }
      setSaveToast(message);
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
            <p className="text-sm text-slate-600">First confirm the record family, then choose an active hierarchy destination where this intake should live. Root family nodes and container-only branches cannot be saved directly.</p>
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
                    if (value === "other") {
                      setHierarchyNodeId("");
                      setHierarchyValidation("");
                    }
                    if (value !== "other" && value !== session.type_detected) rerunByForcedType(value);
                  }}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${selectedType === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <HierarchyPathSelector
              reviewType={selectedType}
              selectedNodeId={hierarchyNodeId}
              canCreate={isAdmin}
              disabled={session.status === "confirmed"}
              onChange={handleHierarchyChange}
              onSelectionChange={handleHierarchySelectionChange}
            />

            {visibleQuickQuestions.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <h3 className="text-sm font-semibold text-slate-800">Quick questions (Step 1 only)</h3>
                <p className="mt-1 text-xs text-slate-600">Answer what you know to auto-fill key fields, or skip and continue.</p>
                <div className="mt-2 space-y-2">
                  {visibleQuickQuestions.slice(0, 3).map((question) => (
                    <div key={question.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                      {question.type === "select" ? (
                        <select
                          value={questionDrafts[question.key] || ""}
                          onChange={(e) => setQuestionDrafts((prev) => ({ ...prev, [question.key]: e.target.value }))}
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
                          value={(questionDrafts[question.key] || "").split(",").map((v) => v.trim()).filter(Boolean)}
                          onChange={(e) => {
                            const selected = Array.from(e.target.selectedOptions).map((o) => o.value).join(", ");
                            setQuestionDrafts((prev) => ({ ...prev, [question.key]: selected }));
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
                          value={questionDrafts[question.key] || ""}
                          onChange={(e) => setQuestionDrafts((prev) => ({ ...prev, [question.key]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitQuestionDraft(question.key);
                            }
                          }}
                          placeholder={question.label}
                          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                        />
                      )}
                      <button
                        onClick={() => commitQuestionDraft(question.key)}
                        disabled={!String(questionDrafts[question.key] || "").trim()}
                        className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                      >
                        Apply
                      </button>
                      <button
                        onClick={() => handleSkipQuestion(question.key)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        Skip
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedType !== "other" && hasUploadedMedia && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="text-sm font-semibold text-slate-800" htmlFor="media-folder-name">Media folder name</label>
                <p className="mt-1 text-xs text-slate-500">
                  This intake includes {mediaCount} uploaded file{mediaCount === 1 ? "" : "s"}. The record will stay on the selected hierarchy node, but the media will be organized into a new child folder under that node.
                </p>
                <input
                  id="media-folder-name"
                  value={mediaFolderName}
                  onChange={(e) => {
                    setMediaFolderName(e.target.value);
                    if (e.target.value.trim()) setMediaFolderValidation("");
                  }}
                  placeholder="e.g. Ahmed Unit Photos"
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                {mediaFolderValidation && (
                  <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {mediaFolderValidation}
                  </div>
                )}
              </div>
            )}

            {selectedType !== "other" && hierarchyValidation && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {hierarchyValidation}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            {selectedType === "other" && <p className="text-sm text-slate-600">Select a type in Step 1 first.</p>}
            {fieldLoadError && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{fieldLoadError}</div>}
            {selectedType !== "other" && intakeFields.length === 0 && !fieldLoadError && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                No intake-visible fields are configured for the current hierarchy path yet.
              </div>
            )}
            {intakeFields.map((field) => {
              const valueKey = fieldValueKey(field);
              const value = field.storage_kind === "core_column" ? form[valueKey] || "" : customFieldValues[field.field_key] || "";
              const rawConfidence = Number((session.ai_meta?.confidence_map || {})[field.core_column_name || field.field_key] ?? 0.6) * 100;
              const ui = confidenceUi(rawConfidence);
              const options = normalizeOptions(field);
              const error = fieldValidationErrors[valueKey];
              const inputClassName = `rounded-lg border px-3 py-2 text-sm ${error ? "border-rose-300 bg-rose-50" : "border-slate-300"}`;

              return (
                <div key={field.id} className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_120px] lg:items-start">
                  <div className="pt-2">
                    <label className="text-sm font-medium text-slate-700">{field.effective_label}</label>
                    <p className="mt-1 text-xs text-slate-500">
                      {field.storage_kind === "custom_value" ? "Custom field" : "Core field"}
                      {field.effective_required ? " • Required" : ""}
                    </p>
                  </div>

                  <div>
                    {field.data_type === "long_text" ? (
                      <textarea
                        value={value}
                        onChange={(e) => handleFieldValueChange(field, e.target.value)}
                        className={`${inputClassName} min-h-24 w-full`}
                      />
                    ) : field.data_type === "boolean" ? (
                      <select value={value} onChange={(e) => handleFieldValueChange(field, e.target.value)} className={`${inputClassName} w-full`}>
                        <option value="">Select</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : (field.data_type === "single_select" || field.data_type === "multi_select") && options.length > 0 ? (
                      <select value={value} onChange={(e) => handleFieldValueChange(field, e.target.value)} className={`${inputClassName} w-full`}>
                        <option value="">{field.data_type === "multi_select" ? "Select / type later" : "Select"}</option>
                        {options.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={value}
                        onChange={(e) => handleFieldValueChange(field, e.target.value)}
                        className={`${inputClassName} w-full`}
                        placeholder={field.storage_kind === "custom_value" ? "Enter value" : undefined}
                      />
                    )}
                    {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
                  </div>

                  <div className="pt-2">
                    <span className={`inline-flex justify-center rounded-full px-2 py-1 text-xs font-semibold ${ui.cls}`}>{ui.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">Is this a new record or update an existing one?</p>
            <div className="flex gap-2">
              <button className={`rounded-lg border px-3 py-2 text-sm ${mode === "create_new" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} onClick={() => { setMode("create_new"); setModeValidation(""); }}>Create New</button>
              <button className={`rounded-lg border px-3 py-2 text-sm ${mode === "update_existing" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} onClick={() => { setMode("update_existing"); setModeValidation(""); }}>Update Existing</button>
            </div>
            {modeValidation && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {modeValidation}
              </div>
            )}

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
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Hierarchy destination</p>
              {selectedHierarchySummary ? (
                <div className="mt-2">
                  <p className="font-medium text-slate-900">{selectedHierarchySummary.name}</p>
                  <p className="text-xs text-slate-600">{selectedHierarchySummary.path}</p>
                  <p className="mt-1 text-xs uppercase text-slate-500">{selectedHierarchySummary.nodeKind}</p>
                </div>
              ) : (
                <p className="mt-1">No hierarchy node selected yet. Go back to Step 1 before saving.</p>
              )}
              {hasUploadedMedia && (
                <p className="mt-2 text-xs text-slate-600">
                  Media will be stored in a new child folder named <span className="font-semibold text-slate-900">{mediaFolderName.trim() || "—"}</span> under the selected hierarchy node.
                </p>
              )}
            </div>

            {mode === "create_new" && <p className="text-sm text-slate-700">A new <strong>{selectedType}</strong> record will be created from reviewed fields.</p>}
            {mode === "update_existing" && mergeableCoreFields.length === 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                No core intake fields are available for merge review on the current hierarchy path.
              </div>
            )}
            {mode === "update_existing" && mergeableCoreFields.map((field) => (
              <div key={field.id} className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-sm font-semibold text-slate-800">{field.effective_label}</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded bg-slate-50 p-2"><p className="text-xs uppercase text-slate-500">Existing</p><p>{String(existingRecord[field.valueKey] ?? "") || "-"}</p></div>
                  <div className="rounded bg-blue-50 p-2"><p className="text-xs uppercase text-slate-500">New Intake</p><p>{form[field.valueKey] || "-"}</p></div>
                </div>
                <div className="mt-2 flex gap-2 text-xs">
                  {([
                    ["keep_existing", "Keep existing"],
                    ["replace_with_new", "Replace with new"],
                    ["append", "Append"]
                  ] as Array<[MergeMode, string]>).map(([value, label]) => (
                    <label key={value} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1">
                      <input type="radio" name={`merge-${field.valueKey}`} checked={(mergeDecisions[field.valueKey] || (field.notes ? "append" : "replace_with_new")) === value} onChange={() => setMergeDecisions((prev) => ({ ...prev, [field.valueKey]: value }))} disabled={value === "append" && !field.notes} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <button disabled={saving || session.status === "confirmed" || !mode || (mode === "update_existing" && !selectedRecordId) || selectedType === "other" || !hierarchyNodeId || (hasUploadedMedia && !mediaFolderName.trim())} onClick={saveConfirmation} className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? "Saving..." : "Confirm & Save"}
            </button>
          </div>
        )}

        <div className="mt-6 flex justify-between">
          <button onClick={() => setStep((s) => Math.max(1, s - 1))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Back</button>
          {step < 4 ? (
            <button onClick={handleNextStep} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">Next</button>
          ) : (
            <div />
          )}
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
        <p className="mt-1 text-xs text-slate-500">Uploaded files stay attached to this intake now. On confirmation, the record stays on the selected hierarchy node while media is organized into the required child media folder.</p>
        <div className="mt-2">
          <MediaManager intakeSessionId={session.id} compact={false} onItemsChange={(items) => setMediaCount(items.length)} />
        </div>
      </aside>
    </div>
  );
}
