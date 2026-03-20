"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createHierarchyNodeApi,
  ensureHierarchyRootApi,
  fetchFieldDefinitionsApi,
  saveFieldDefinitionApi,
  type HierarchyFamily,
  type HierarchyNodeKind
} from "@/services/api/hierarchy-api.service";
import type { EffectiveFieldDefinition, HierarchyNode } from "@/types/hierarchy";

type NodeMutationMode = "folder" | "record" | "hybrid";

type FieldDraft = {
  enabled: boolean;
  label: string;
  visible: boolean;
  required: boolean;
  filterable: boolean;
  sortable: boolean;
  gridVisible: boolean;
  intakeVisible: boolean;
  detailVisible: boolean;
  displayOrder: string;
  widthPx: string;
};

type Props = {
  open: boolean;
  family: HierarchyFamily;
  parentNode: HierarchyNode | null;
  onClose: () => void;
  onCreated: (node: HierarchyNode, options: { openCreatedNode: boolean }) => Promise<void> | void;
  onRootReady: (rootNodeId: string) => Promise<void> | void;
};

const NODE_KIND_OPTIONS: Array<{ value: Exclude<HierarchyNodeKind, "root">; label: string }> = [
  { value: "folder", label: "Folder" },
  { value: "project", label: "Project" },
  { value: "building", label: "Building" },
  { value: "unit", label: "Unit" },
  { value: "phase", label: "Phase" },
  { value: "custom", label: "Custom" }
];

const CHILD_MODE_OPTIONS: Array<{ value: NodeMutationMode; label: string; description: string }> = [
  { value: "folder", label: "Folder only", description: "Navigation-only child that can hold more nested nodes." },
  { value: "record", label: "Record-container only", description: "Assignable destination that does not allow child nodes." },
  { value: "hybrid", label: "Folder + record", description: "Can both contain records and allow deeper child nodes." }
];

function slugifyNodeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function behaviorFromMode(mode: NodeMutationMode) {
  return {
    canHaveChildren: mode !== "record",
    canContainRecords: mode !== "folder"
  };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "Unable to complete the hierarchy request.";
}

function buildDraft(field: EffectiveFieldDefinition): FieldDraft {
  return {
    enabled: false,
    label: "",
    visible: field.effective_visible,
    required: field.effective_required,
    filterable: field.effective_filterable,
    sortable: field.effective_sortable,
    gridVisible: field.effective_grid_visible,
    intakeVisible: field.effective_intake_visible,
    detailVisible: field.effective_detail_visible,
    displayOrder: "",
    widthPx: ""
  };
}

export function HierarchyNodeCreateModal({ open, family, parentNode, onClose, onCreated, onRootReady }: Props) {
  const [name, setName] = useState("");
  const [nodeKey, setNodeKey] = useState("");
  const [nodeKind, setNodeKind] = useState<Exclude<HierarchyNodeKind, "root">>("folder");
  const [mode, setMode] = useState<NodeMutationMode>("folder");
  const [openCreatedNode, setOpenCreatedNode] = useState(false);
  const [fields, setFields] = useState<EffectiveFieldDefinition[]>([]);
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, FieldDraft>>({});
  const [loadingFields, setLoadingFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const availableModes = family === "media" ? CHILD_MODE_OPTIONS.filter((option) => option.value === "folder") : CHILD_MODE_OPTIONS;
  const parentLabel = parentNode?.path_text || parentNode?.name || `${family} root`;
  const canCreateUnderParent = Boolean(parentNode?.can_have_children);

  const fieldCards = useMemo(
    () => fields.map((field) => ({ field, draft: fieldDrafts[field.id] || buildDraft(field) })),
    [fieldDrafts, fields]
  );

  useEffect(() => {
    if (!open) return;
    setName("");
    setNodeKey("");
    setNodeKind(family === "media" ? "folder" : "folder");
    setMode("folder");
    setOpenCreatedNode(false);
    setError("");
    setNotice("");
  }, [family, open]);

  useEffect(() => {
    if (!open) return;

    let active = true;
    async function loadFields() {
      setLoadingFields(true);
      setError("");
      try {
        const result = await fetchFieldDefinitionsApi(family, parentNode?.id || undefined);
        if (!active) return;
        const nextFields = result.fields || [];
        setFields(nextFields);
        setFieldDrafts(Object.fromEntries(nextFields.map((field) => [field.id, buildDraft(field)])));
      } catch (loadError) {
        if (!active) return;
        setFields([]);
        setFieldDrafts({});
        setError(formatError(loadError));
      } finally {
        if (active) setLoadingFields(false);
      }
    }

    loadFields();
    return () => {
      active = false;
    };
  }, [family, open, parentNode?.id]);

  function updateDraft(fieldId: string, patch: Partial<FieldDraft>) {
    setFieldDrafts((current) => {
      const matchingField = fields.find((field) => field.id === fieldId);
      const baseDraft = current[fieldId] || (matchingField ? buildDraft(matchingField) : null);
      if (!baseDraft) return current;

      return {
        ...current,
        [fieldId]: {
          ...baseDraft,
          ...patch
        }
      };
    });
  }

  async function handleEnsureRoot() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await ensureHierarchyRootApi(family);
      await onRootReady(result.node.id);
      setNotice(`${result.node.name} root is ready. You can create the child folder now.`);
    } catch (ensureError) {
      setError(formatError(ensureError));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (!name.trim() || !nodeKey.trim()) {
      setError("Child name and stable key are required.");
      return;
    }
    if (!parentNode) {
      setError("Create or load the family root before adding child folders here.");
      return;
    }
    if (!parentNode.can_have_children) {
      setError("The current path cannot contain child nodes. Choose a different path before creating a child folder.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const effectiveMode = family === "media" ? "folder" : mode;
      const behavior = behaviorFromMode(effectiveMode);
      const result = await createHierarchyNodeApi({
        family,
        parentId: parentNode.id,
        nodeKind,
        name: name.trim(),
        nodeKey: nodeKey.trim(),
        allowRecordAssignment: behavior.canContainRecords,
        mutationMode: effectiveMode,
        canHaveChildren: behavior.canHaveChildren,
        canContainRecords: behavior.canContainRecords
      });

      const overrideRequests = fieldCards
        .filter(({ draft }) => draft.enabled)
        .map(({ field, draft }) =>
          saveFieldDefinitionApi({
            id: field.id,
            family,
            fieldKey: field.field_key,
            defaultLabel: field.default_label,
            description: field.description,
            dataType: field.data_type,
            storageKind: field.storage_kind,
            coreColumnName: field.core_column_name,
            isSystem: field.is_system,
            isActive: field.is_active,
            isVisibleDefault: field.is_visible_default,
            isRequiredDefault: field.is_required_default,
            isFilterableDefault: field.is_filterable_default,
            isSortableDefault: field.is_sortable_default,
            isGridVisibleDefault: field.is_grid_visible_default,
            isIntakeVisibleDefault: field.is_intake_visible_default,
            isDetailVisibleDefault: field.is_detail_visible_default,
            displayOrderDefault: field.display_order_default,
            optionsJson: field.options_json,
            validationJson: field.validation_json,
            override: {
              nodeId: result.node.id,
              overrideLabel: draft.label.trim() || null,
              isVisible: draft.visible,
              isRequired: draft.required,
              isFilterable: draft.filterable,
              isSortable: draft.sortable,
              isGridVisible: draft.gridVisible,
              isIntakeVisible: draft.intakeVisible,
              isDetailVisible: draft.detailVisible,
              displayOrder: draft.displayOrder ? Number(draft.displayOrder) : null,
              widthPx: draft.widthPx ? Number(draft.widthPx) : null
            }
          })
        );

      await Promise.all(overrideRequests);
      await onCreated(result.node, { openCreatedNode });
      onClose();
    } catch (createError) {
      setError(formatError(createError));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Add Folder</h3>
            <p className="mt-1 text-sm text-slate-600">Create a child node under the current hierarchy path and optionally configure field overrides immediately.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
        </div>

        <div className="max-h-[calc(90vh-76px)] overflow-y-auto px-6 py-5">
          {(error || notice) && (
            <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              {error || notice}
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current parent path</p>
                <p className="mt-2 text-base font-semibold text-slate-900">{parentLabel}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {parentNode
                    ? canCreateUnderParent
                      ? "The new node will be created directly under this path."
                      : "This path cannot contain child nodes, so creation is disabled until you choose a different path."
                    : "No family root exists yet. Create the family root first, then add a child node under it."}
                </p>
                {!parentNode && (
                  <button type="button" onClick={handleEnsureRoot} disabled={saving} className="mt-4 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                    Ensure family root
                  </button>
                )}
              </div>

              <div className="grid gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Child name</label>
                  <input
                    value={name}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setName(nextValue);
                      setNodeKey((current) => (current ? current : slugifyNodeKey(nextValue)));
                    }}
                    disabled={saving}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Building A"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Stable key</label>
                  <input
                    value={nodeKey}
                    onChange={(event) => setNodeKey(slugifyNodeKey(event.target.value))}
                    disabled={saving}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="building-a"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Node kind</label>
                  <select value={nodeKind} onChange={(event) => setNodeKind(event.target.value as Exclude<HierarchyNodeKind, "root">)} disabled={saving} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {NODE_KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">After create</p>
                  <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={openCreatedNode} onChange={(event) => setOpenCreatedNode(event.target.checked)} />
                    Open the new node after creation
                  </label>
                </div>
                <div className="md:col-span-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Behavior</p>
                  <div className="grid gap-2 md:grid-cols-3">
                    {availableModes.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setMode(option.value)}
                        disabled={saving}
                        className={`rounded-xl border px-3 py-3 text-left ${mode === option.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                      >
                        <p className="text-sm font-semibold">{option.label}</p>
                        <p className={`mt-1 text-xs ${mode === option.value ? "text-white/80" : "text-slate-500"}`}>{option.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Field configuration</h4>
                  <p className="mt-1 text-xs text-slate-500">Choose any inherited family fields you want to override for the new node immediately after creation.</p>
                </div>
                {loadingFields && <span className="text-xs text-slate-500">Loading fields…</span>}
              </div>

              {fieldCards.length > 0 ? (
                <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                  {fieldCards.map(({ field, draft }) => (
                    <div key={field.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="font-medium text-slate-900">{field.effective_label}</p>
                          <p className="mt-1 text-xs text-slate-500">{field.field_key} • {field.storage_kind}</p>
                        </div>
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft(field.id, { enabled: event.target.checked })} />
                          Customize on create
                        </label>
                      </div>

                      {draft.enabled && (
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Override label</label>
                            <input value={draft.label} onChange={(event) => updateDraft(field.id, { label: event.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={field.effective_label} />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Order</label>
                              <input type="number" value={draft.displayOrder} onChange={(event) => updateDraft(field.id, { displayOrder: event.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={String(field.effective_display_order)} />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Width</label>
                              <input type="number" value={draft.widthPx} onChange={(event) => updateDraft(field.id, { widthPx: event.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Optional" />
                            </div>
                          </div>
                          <div className="md:col-span-2 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-3">
                            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.visible} onChange={(event) => updateDraft(field.id, { visible: event.target.checked })} /> Visible</label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.required} onChange={(event) => updateDraft(field.id, { required: event.target.checked })} /> Required</label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.filterable} onChange={(event) => updateDraft(field.id, { filterable: event.target.checked })} /> Filterable</label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.sortable} onChange={(event) => updateDraft(field.id, { sortable: event.target.checked })} /> Sortable</label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.gridVisible} onChange={(event) => updateDraft(field.id, { gridVisible: event.target.checked })} /> Grid visible</label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.intakeVisible} onChange={(event) => updateDraft(field.id, { intakeVisible: event.target.checked })} /> Intake visible</label>
                            <label className="flex items-center gap-2 sm:col-span-2 xl:col-span-3"><input type="checkbox" checked={draft.detailVisible} onChange={(event) => updateDraft(field.id, { detailVisible: event.target.checked })} /> Detail visible</label>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                  {loadingFields ? "Loading field configuration…" : "No active family fields were returned for this path. You can still create the node now and configure fields later in the Hierarchy Manager."}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving || !name.trim() || !nodeKey.trim() || !parentNode || !canCreateUnderParent} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            {saving ? "Creating…" : "Create child node"}
          </button>
        </div>
      </div>
    </div>
  );
}
