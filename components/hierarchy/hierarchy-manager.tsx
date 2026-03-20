"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { useAuth } from "@/hooks/use-auth";
import {
  archiveHierarchyNodeApi,
  createHierarchyNodeApi,
  deleteHierarchyFieldApi,
  deleteHierarchyNodeApi,
  ensureHierarchyRootApi,
  fetchFieldDefinitionsApi,
  fetchHierarchyFieldDeleteImpactApi,
  fetchHierarchyNodeDetailsApi,
  fetchHierarchyTreeApi,
  saveFieldDefinitionApi,
  updateHierarchyNodeApi,
  type HierarchyFamily,
  type HierarchyNodeKind
} from "@/services/api/hierarchy-api.service";
import type { EffectiveFieldDefinition, FieldDataType, FieldStorageKind, HierarchyNode, HierarchyNodeDetails, HierarchyTreeNode } from "@/types/hierarchy";

type NodeMutationMode = "folder" | "record" | "hybrid";

const FAMILY_OPTIONS: Array<{ id: HierarchyFamily; label: string }> = [
  { id: "sale", label: "Sale" },
  { id: "rent", label: "Rent" },
  { id: "buyers", label: "Buyers" },
  { id: "clients", label: "Clients" },
  { id: "media", label: "Media" }
];

const NODE_KIND_OPTIONS: Array<{ value: HierarchyNodeKind; label: string }> = [
  { value: "folder", label: "Folder" },
  { value: "project", label: "Project" },
  { value: "building", label: "Building" },
  { value: "unit", label: "Unit" },
  { value: "phase", label: "Phase" },
  { value: "custom", label: "Custom" }
];

const CHILD_MODE_OPTIONS: Array<{ value: NodeMutationMode; label: string; description: string }> = [
  { value: "folder", label: "Folder child", description: "Navigation-only child that can hold more nested nodes." },
  { value: "record", label: "Record container", description: "Leaf-like destination that intake and records can be assigned into." },
  { value: "hybrid", label: "Folder + record", description: "Can both hold children and receive records when you need a mixed node." }
];

const FIELD_TYPE_OPTIONS: Array<{ value: FieldDataType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "long_text", label: "Long text" },
  { value: "integer", label: "Integer" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
  { value: "timestamp", label: "Timestamp" },
  { value: "single_select", label: "Single select" },
  { value: "multi_select", label: "Multi select" },
  { value: "json", label: "JSON" }
];

const FIELD_STORAGE_OPTIONS: Array<{ value: FieldStorageKind; label: string }> = [
  { value: "custom_value", label: "Custom value" },
  { value: "core_column", label: "Core column" }
];

function flattenTree(nodes: HierarchyTreeNode[]): HierarchyNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function slugifyNodeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function behaviorLabel(canHaveChildren: boolean, canContainRecords: boolean) {
  if (canHaveChildren && canContainRecords) return "Folder + record";
  if (canContainRecords) return "Record container";
  return "Folder only";
}

function mutationModeFromBehavior(canHaveChildren: boolean, canContainRecords: boolean): NodeMutationMode {
  if (canHaveChildren && canContainRecords) return "hybrid";
  if (canContainRecords) return "record";
  return "folder";
}

function behaviorFromMode(mode: NodeMutationMode) {
  return {
    canHaveChildren: mode !== "record",
    canContainRecords: mode !== "folder"
  };
}

function formatParentLabel(details: HierarchyNodeDetails | null) {
  if (!details?.parent) return "No parent (family root)";
  return details.parent.name;
}

type FieldDeleteImpact = {
  override_count: number;
  custom_value_count: number;
  hard_delete_allowed: boolean;
};


function hasNodeOverride(field: EffectiveFieldDefinition, nodeId?: string) {
  return Boolean(nodeId && field.override_source_node_id === nodeId);
}

function stringifyJson(value: Record<string, unknown> | null | undefined) {
  return value ? JSON.stringify(value, null, 2) : "{}";
}

function TreeRow({
  node,
  selectedId,
  onSelect
}: {
  node: HierarchyTreeNode;
  selectedId: string;
  onSelect: (node: HierarchyNode) => void;
}) {
  const isSelected = node.id === selectedId;
  const assignable = node.allow_record_assignment && node.is_active && !node.is_root;

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(node)}
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
          isSelected
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-transparent bg-white text-slate-700 hover:border-slate-200 hover:bg-slate-50"
        }`}
        style={{ paddingLeft: `${node.depth * 18 + 12}px` }}
      >
        <div className="min-w-0">
          <p className="truncate font-medium">{node.name}</p>
          <p className={`truncate text-xs ${isSelected ? "text-white/80" : "text-slate-500"}`}>{node.path_text}</p>
        </div>
        <div className="ml-3 flex shrink-0 flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${isSelected ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"}`}>
            {node.node_kind}
          </span>
          {node.is_root && <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${isSelected ? "bg-white/15 text-white" : "bg-blue-100 text-blue-700"}`}>root</span>}
          {assignable && <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${isSelected ? "bg-white/15 text-white" : "bg-emerald-100 text-emerald-700"}`}>intake</span>}
          {!node.is_active && <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${isSelected ? "bg-white/15 text-white" : "bg-amber-100 text-amber-800"}`}>archived</span>}
        </div>
      </button>
      {node.children.length > 0 && node.children.map((child) => <TreeRow key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />)}
    </div>
  );
}

export function HierarchyManager() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = (user?.role || "viewer") === "admin";

  const [family, setFamily] = useState<HierarchyFamily>("sale");
  const [tree, setTree] = useState<HierarchyTreeNode[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [fields, setFields] = useState<EffectiveFieldDefinition[]>([]);
  const [nodeDetails, setNodeDetails] = useState<HierarchyNodeDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteNodeOpen, setDeleteNodeOpen] = useState(false);
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<EffectiveFieldDefinition | null>(null);
  const [deleteFieldImpact, setDeleteFieldImpact] = useState<FieldDeleteImpact | null>(null);
  const [deleteFieldLoading, setDeleteFieldLoading] = useState(false);

  const [editName, setEditName] = useState("");
  const [editKey, setEditKey] = useState("");
  const [editKind, setEditKind] = useState<HierarchyNodeKind>("folder");
  const [editCanHaveChildren, setEditCanHaveChildren] = useState(true);
  const [editCanContainRecords, setEditCanContainRecords] = useState(false);

  const [childName, setChildName] = useState("");
  const [childKey, setChildKey] = useState("");
  const [childKind, setChildKind] = useState<HierarchyNodeKind>("folder");
  const [childMode, setChildMode] = useState<NodeMutationMode>("folder");

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [fieldKeyInput, setFieldKeyInput] = useState("");
  const [fieldLabelInput, setFieldLabelInput] = useState("");
  const [fieldDescriptionInput, setFieldDescriptionInput] = useState("");
  const [fieldTypeInput, setFieldTypeInput] = useState<FieldDataType>("text");
  const [fieldStorageInput, setFieldStorageInput] = useState<FieldStorageKind>("custom_value");
  const [fieldCoreColumnInput, setFieldCoreColumnInput] = useState("");
  const [fieldDisplayOrderInput, setFieldDisplayOrderInput] = useState("100");
  const [fieldVisibleInput, setFieldVisibleInput] = useState(true);
  const [fieldRequiredInput, setFieldRequiredInput] = useState(false);
  const [fieldGridVisibleInput, setFieldGridVisibleInput] = useState(true);
  const [fieldIntakeVisibleInput, setFieldIntakeVisibleInput] = useState(true);
  const [fieldDetailVisibleInput, setFieldDetailVisibleInput] = useState(true);
  const [fieldFilterableInput, setFieldFilterableInput] = useState(true);
  const [fieldSortableInput, setFieldSortableInput] = useState(true);
  const [fieldOptionsInput, setFieldOptionsInput] = useState("{}");
  const [fieldValidationInput, setFieldValidationInput] = useState("{}");

  const [overrideLabelInput, setOverrideLabelInput] = useState("");
  const [overrideDisplayOrderInput, setOverrideDisplayOrderInput] = useState("");
  const [overrideWidthInput, setOverrideWidthInput] = useState("");
  const [overrideVisibleInput, setOverrideVisibleInput] = useState(true);
  const [overrideRequiredInput, setOverrideRequiredInput] = useState(false);
  const [overrideGridVisibleInput, setOverrideGridVisibleInput] = useState(true);
  const [overrideIntakeVisibleInput, setOverrideIntakeVisibleInput] = useState(true);
  const [overrideDetailVisibleInput, setOverrideDetailVisibleInput] = useState(true);
  const [overrideFilterableInput, setOverrideFilterableInput] = useState(true);
  const [overrideSortableInput, setOverrideSortableInput] = useState(true);

  const flatNodes = useMemo(() => flattenTree(tree), [tree]);
  const selectedNode = flatNodes.find((node) => node.id === selectedId) || null;
  const rootNode = tree[0] || null;
  const selectedAssignable = Boolean(selectedNode && selectedNode.allow_record_assignment && selectedNode.is_active && !selectedNode.is_root);
  const availableChildModes = family === "media" ? CHILD_MODE_OPTIONS.filter((option) => option.value === "folder") : CHILD_MODE_OPTIONS;
  const editingField = fields.find((field) => field.id === editingFieldId) || null;

  async function loadTree(nextFamily = family, preferredNodeId?: string) {
    setLoading(true);
    setError("");
    try {
      const [treeResult, fieldsResult] = await Promise.all([
        fetchHierarchyTreeApi(nextFamily),
        fetchFieldDefinitionsApi(nextFamily, preferredNodeId)
      ]);
      setTree(treeResult.tree || []);
      const nextSelected = preferredNodeId || treeResult.tree[0]?.id || "";
      setSelectedId(nextSelected);

      if (nextSelected) {
        const [nodeFields, details] = await Promise.all([
          fetchFieldDefinitionsApi(nextFamily, nextSelected),
          fetchHierarchyNodeDetailsApi(nextSelected)
        ]);
        setFields(nodeFields.fields || []);
        setNodeDetails(details);
      } else {
        setFields(fieldsResult.fields || []);
        setNodeDetails(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load hierarchy");
      setTree([]);
      setFields([]);
      setNodeDetails(null);
      setSelectedId("");
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedNode(nodeId: string, nextFamily = family) {
    try {
      const [fieldResult, details] = await Promise.all([
        fetchFieldDefinitionsApi(nextFamily, nodeId),
        fetchHierarchyNodeDetailsApi(nodeId)
      ]);
      setFields(fieldResult.fields || []);
      setNodeDetails(details);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load node details");
      setFields([]);
      setNodeDetails(null);
    }
  }

  useEffect(() => {
    if (!authLoading && isAdmin) {
      loadTree(family);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family, authLoading, isAdmin]);

  useEffect(() => {
    if (!selectedNode) {
      setEditName("");
      setEditKey("");
      setEditKind("folder");
      setEditCanHaveChildren(true);
      setEditCanContainRecords(false);
      setNodeDetails(null);
      return;
    }

    setEditName(selectedNode.name);
    setEditKey(selectedNode.node_key);
    setEditKind(selectedNode.node_kind);
    setEditCanHaveChildren(selectedNode.can_have_children);
    setEditCanContainRecords(selectedNode.can_contain_records);
  }, [selectedNode]);

  useEffect(() => {
    if (family === "media" && childMode !== "folder") {
      setChildMode("folder");
      setChildKind("folder");
    }
  }, [childMode, family]);

  useEffect(() => {
    if (!editingField) {
      setFieldKeyInput("");
      setFieldLabelInput("");
      setFieldDescriptionInput("");
      setFieldTypeInput("text");
      setFieldStorageInput("custom_value");
      setFieldCoreColumnInput("");
      setFieldDisplayOrderInput("100");
      setFieldVisibleInput(true);
      setFieldRequiredInput(false);
      setFieldGridVisibleInput(true);
      setFieldIntakeVisibleInput(true);
      setFieldDetailVisibleInput(true);
      setFieldFilterableInput(true);
      setFieldSortableInput(true);
      setFieldOptionsInput("{}");
      setFieldValidationInput("{}");
      setOverrideLabelInput("");
      setOverrideDisplayOrderInput("");
      setOverrideWidthInput("");
      setOverrideVisibleInput(true);
      setOverrideRequiredInput(false);
      setOverrideGridVisibleInput(true);
      setOverrideIntakeVisibleInput(true);
      setOverrideDetailVisibleInput(true);
      setOverrideFilterableInput(true);
      setOverrideSortableInput(true);
      return;
    }

    setFieldKeyInput(editingField.field_key);
    setFieldLabelInput(editingField.default_label);
    setFieldDescriptionInput(editingField.description || "");
    setFieldTypeInput(editingField.data_type);
    setFieldStorageInput(editingField.storage_kind);
    setFieldCoreColumnInput(editingField.core_column_name || "");
    setFieldDisplayOrderInput(String(editingField.display_order_default));
    setFieldVisibleInput(editingField.is_visible_default);
    setFieldRequiredInput(editingField.is_required_default);
    setFieldGridVisibleInput(editingField.is_grid_visible_default);
    setFieldIntakeVisibleInput(editingField.is_intake_visible_default);
    setFieldDetailVisibleInput(editingField.is_detail_visible_default);
    setFieldFilterableInput(editingField.is_filterable_default);
    setFieldSortableInput(editingField.is_sortable_default);
    setFieldOptionsInput(stringifyJson(editingField.options_json));
    setFieldValidationInput(stringifyJson(editingField.validation_json));
    setOverrideLabelInput(editingField.override_source_node_id === selectedId ? (editingField.effective_label === editingField.default_label ? "" : editingField.effective_label) : "");
    setOverrideDisplayOrderInput(editingField.override_source_node_id === selectedId && editingField.effective_display_order !== editingField.display_order_default ? String(editingField.effective_display_order) : "");
    setOverrideWidthInput(editingField.override_source_node_id === selectedId && editingField.effective_width_px ? String(editingField.effective_width_px) : "");
    setOverrideVisibleInput(editingField.effective_visible);
    setOverrideRequiredInput(editingField.effective_required);
    setOverrideGridVisibleInput(editingField.effective_grid_visible);
    setOverrideIntakeVisibleInput(editingField.effective_intake_visible);
    setOverrideDetailVisibleInput(editingField.effective_detail_visible);
    setOverrideFilterableInput(editingField.effective_filterable);
    setOverrideSortableInput(editingField.effective_sortable);
  }, [editingField, selectedId]);

  async function handleSelect(node: HierarchyNode) {
    setSelectedId(node.id);
    setNotice("");
    setError("");
    await loadSelectedNode(node.id);
  }

  async function handleSaveNode() {
    if (!selectedNode) return;
    if (!editName.trim() || !editKey.trim()) {
      setError("Name and stable key are required before saving.");
      return;
    }
    if (!editCanHaveChildren && !editCanContainRecords) {
      setError("A node must either allow children, contain records, or both.");
      return;
    }
    if (selectedNode.is_root) {
      setError("Family roots are navigation-only. Create or edit child nodes instead.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateHierarchyNodeApi(selectedNode.id, {
        name: editName.trim(),
        nodeKey: editKey.trim(),
        nodeKind: editKind,
        canHaveChildren: editCanHaveChildren,
        canContainRecords: editCanContainRecords,
        allowRecordAssignment: editCanContainRecords,
        mutationMode: mutationModeFromBehavior(editCanHaveChildren, editCanContainRecords)
      });
      setNotice(`Saved ${result.node.name}.`);
      await loadTree(family, result.node.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save node");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleArchive() {
    if (!selectedNode) return;
    const confirmed = window.confirm(
      selectedNode.is_active
        ? `Archive ${selectedNode.name}? Archived nodes cannot receive records or media.`
        : `Restore ${selectedNode.name}?`
    );
    if (!confirmed) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await archiveHierarchyNodeApi(selectedNode.id, selectedNode.is_active);
      setNotice(result.node.is_active ? `Restored ${result.node.name}.` : `Archived ${result.node.name}.`);
      await loadTree(family, result.node.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to archive node");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateChild() {
    const parent = selectedNode || rootNode;
    if (!parent) {
      setError("Create or load the family root before adding child nodes.");
      return;
    }
    if (!childName.trim() || !childKey.trim()) {
      setError("Child name and stable key are required.");
      return;
    }

    const effectiveChildMode = family === "media" ? "folder" : childMode;
    const childBehavior = behaviorFromMode(effectiveChildMode);

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await createHierarchyNodeApi({
        family,
        parentId: parent.id,
        nodeKind: childKind,
        name: childName.trim(),
        nodeKey: childKey.trim(),
        allowRecordAssignment: childBehavior.canContainRecords,
        mutationMode: effectiveChildMode,
        canHaveChildren: childBehavior.canHaveChildren,
        canContainRecords: childBehavior.canContainRecords
      });
      setChildName("");
      setChildKey("");
      setChildKind(family === "media" ? "folder" : effectiveChildMode === "record" ? "unit" : "folder");
      setChildMode("folder");
      setNotice(`Created ${result.node.name}.`);
      await loadTree(family, result.node.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to create child node");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedNode) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await deleteHierarchyNodeApi(selectedNode.id);
      setNotice(`Deleted ${selectedNode.name}.`);
      await loadTree(family);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete node");
    } finally {
      setSaving(false);
    }
  }

  async function openDeleteFieldModal(field: EffectiveFieldDefinition) {
    setDeleteFieldTarget(field);
    setDeleteFieldImpact(null);
    setDeleteFieldLoading(true);
    setError("");
    try {
      const result = await fetchHierarchyFieldDeleteImpactApi(field.id);
      setDeleteFieldImpact(result.impact);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load field delete impact");
    } finally {
      setDeleteFieldLoading(false);
    }
  }

  async function handleEnsureRoot() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await ensureHierarchyRootApi(family);
      setNotice(`Ensured ${result.node.name} root.`);
      await loadTree(family, result.node.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to ensure family root");
    } finally {
      setSaving(false);
    }
  }

  function startCreateField() {
    setEditingFieldId(null);
    setFieldKeyInput("");
    setFieldLabelInput("");
    setFieldDescriptionInput("");
    setFieldTypeInput("text");
    setFieldStorageInput("custom_value");
    setFieldCoreColumnInput("");
    setFieldDisplayOrderInput("100");
    setFieldVisibleInput(true);
    setFieldRequiredInput(false);
    setFieldGridVisibleInput(true);
    setFieldIntakeVisibleInput(true);
    setFieldDetailVisibleInput(true);
    setFieldFilterableInput(true);
    setFieldSortableInput(true);
    setFieldOptionsInput("{}");
    setFieldValidationInput("{}");
  }

  function startEditField(field: EffectiveFieldDefinition) {
    setEditingFieldId(field.id);
  }

  function parseJsonInput(value: string, fieldName: string) {
    try {
      const parsed = JSON.parse(value || "{}");
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error(`${fieldName} must be a JSON object.`);
      }
      return parsed as Record<string, unknown>;
    } catch (jsonError) {
      throw new Error(jsonError instanceof Error && jsonError.message.includes(fieldName) ? jsonError.message : `${fieldName} must be valid JSON.`);
    }
  }

  async function handleSaveFieldDefinition() {
    if (!fieldKeyInput.trim() || !fieldLabelInput.trim()) {
      setError("Field key and default label are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const optionsJson = parseJsonInput(fieldOptionsInput, "Options JSON");
      const validationJson = parseJsonInput(fieldValidationInput, "Validation JSON");

      const result = await saveFieldDefinitionApi({
        id: editingFieldId || undefined,
        family,
        fieldKey: fieldKeyInput.trim(),
        defaultLabel: fieldLabelInput.trim(),
        description: fieldDescriptionInput.trim() || null,
        dataType: fieldTypeInput,
        storageKind: fieldStorageInput,
        coreColumnName: fieldStorageInput === "core_column" ? fieldCoreColumnInput.trim() || null : null,
        isSystem: editingField?.is_system ?? false,
        isActive: true,
        isVisibleDefault: fieldVisibleInput,
        isRequiredDefault: fieldRequiredInput,
        isFilterableDefault: fieldFilterableInput,
        isSortableDefault: fieldSortableInput,
        isGridVisibleDefault: fieldGridVisibleInput,
        isIntakeVisibleDefault: fieldIntakeVisibleInput,
        isDetailVisibleDefault: fieldDetailVisibleInput,
        displayOrderDefault: Number(fieldDisplayOrderInput || 100),
        optionsJson,
        validationJson
      });

      setNotice(`${result.field.default_label || fieldLabelInput.trim()} saved.`);
      await loadTree(family, selectedId || undefined);
      setEditingFieldId(result.field.id || editingFieldId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save field definition");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveFieldOverride() {
    if (!selectedNode || !editingField) {
      setError("Select a node and a field before saving an override.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const optionsJson = parseJsonInput(fieldOptionsInput, "Options JSON");
      const validationJson = parseJsonInput(fieldValidationInput, "Validation JSON");
      await saveFieldDefinitionApi({
        id: editingField.id,
        family,
        fieldKey: fieldKeyInput.trim(),
        defaultLabel: fieldLabelInput.trim(),
        description: fieldDescriptionInput.trim() || null,
        dataType: fieldTypeInput,
        storageKind: fieldStorageInput,
        coreColumnName: fieldStorageInput === "core_column" ? fieldCoreColumnInput.trim() || null : null,
        isSystem: editingField.is_system,
        isActive: editingField.is_active,
        isVisibleDefault: fieldVisibleInput,
        isRequiredDefault: fieldRequiredInput,
        isFilterableDefault: fieldFilterableInput,
        isSortableDefault: fieldSortableInput,
        isGridVisibleDefault: fieldGridVisibleInput,
        isIntakeVisibleDefault: fieldIntakeVisibleInput,
        isDetailVisibleDefault: fieldDetailVisibleInput,
        displayOrderDefault: Number(fieldDisplayOrderInput || editingField.display_order_default),
        optionsJson,
        validationJson,
        override: {
          nodeId: selectedNode.id,
          overrideLabel: overrideLabelInput.trim() || null,
          isVisible: overrideVisibleInput,
          isRequired: overrideRequiredInput,
          isFilterable: overrideFilterableInput,
          isSortable: overrideSortableInput,
          isGridVisible: overrideGridVisibleInput,
          isIntakeVisible: overrideIntakeVisibleInput,
          isDetailVisible: overrideDetailVisibleInput,
          displayOrder: overrideDisplayOrderInput ? Number(overrideDisplayOrderInput) : null,
          widthPx: overrideWidthInput ? Number(overrideWidthInput) : null
        }
      });

      setNotice(`Override saved for ${editingField.default_label}.`);
      await loadSelectedNode(selectedNode.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save field override");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteField(field: EffectiveFieldDefinition) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await deleteHierarchyFieldApi(field.id);
      setNotice(`${field.default_label} deleted permanently.${result.impact ? ` Removed ${result.impact.custom_value_count} stored value(s) and ${result.impact.override_count} override(s).` : ""}`);
      setDeleteFieldTarget(null);
      setDeleteFieldImpact(null);
      if (editingFieldId === field.id) startCreateField();
      await loadTree(family, selectedId || undefined);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete field");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetOverride(field: EffectiveFieldDefinition) {
    if (!selectedNode) return;
    const confirmed = window.confirm(`Reset the node-specific override for ${field.default_label}?`);
    if (!confirmed) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await deleteHierarchyFieldApi(field.id, { nodeId: selectedNode.id });
      setNotice(`Override removed for ${field.default_label}.`);
      await loadSelectedNode(selectedNode.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to reset override");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Checking permissions...</section>;
  }

  if (!isAdmin) {
    return (
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">
        This page is restricted to CRM admins.
      </section>
    );
  }

  return (
    <>
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Hierarchy Manager</h2>
            <p className="mt-1 text-sm text-slate-600">Manage family roots, child folders, and assignable record-container nodes without leaving the admin dashboard.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {FAMILY_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => setFamily(option.id)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${family === option.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {(error || notice) && (
        <div className={`rounded-xl border px-4 py-3 text-sm shadow-sm ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {error || notice}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{FAMILY_OPTIONS.find((item) => item.id === family)?.label} hierarchy</h3>
              <p className="text-xs text-slate-500">Select a node to manage its settings and child paths.</p>
            </div>
            <button onClick={() => loadTree(family, selectedId || undefined)} className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Loading hierarchy tree…</div>
          ) : tree.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              <p>No nodes were returned for this family yet. Start by ensuring the family root.</p>
              <div className="mt-3">
                <button disabled={saving} onClick={handleEnsureRoot} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                  Ensure family root
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {tree.map((node) => (
                <TreeRow key={node.id} node={node} selectedId={selectedId} onSelect={handleSelect} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected node</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">{selectedNode?.name || "No node selected"}</h3>
                <p className="mt-1 text-sm text-slate-600">{selectedNode ? selectedNode.path_text : "Select a node from the tree to manage it."}</p>
              </div>
              {selectedNode && (
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${selectedNode.is_active ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                    {selectedNode.is_active ? "Active" : "Archived"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase text-slate-700">
                    {behaviorLabel(selectedNode.can_have_children, selectedNode.can_contain_records)}
                  </span>
                </div>
              )}
            </div>

            {!selectedNode ? (
              <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Choose a root or child node from the tree to view metadata and actions.
              </div>
            ) : (
              <div className="mt-5 space-y-5">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</p>
                    <p className="mt-1 font-medium text-slate-900">{selectedNode.node_kind}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parent</p>
                    <p className="mt-1 font-medium text-slate-900">{formatParentLabel(nodeDetails)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Path</p>
                    <p className="mt-1 font-medium text-slate-900">{selectedNode.path_text}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Can have children</p>
                    <p className="mt-1 font-medium text-slate-900">{selectedNode.can_have_children ? "Yes" : "No"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Can contain records</p>
                    <p className="mt-1 font-medium text-slate-900">{selectedNode.can_contain_records ? "Yes" : "No"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assignable from intake</p>
                    <p className="mt-1 font-medium text-slate-900">{selectedAssignable ? "Yes" : "No"}</p>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900">Edit selected node</h4>
                        <p className="mt-1 text-xs text-slate-500">Rename and configure whether this node is folder-only, record-ready, or both.</p>
                      </div>
                      {selectedNode.is_root && <span className="rounded-full bg-blue-100 px-3 py-1 text-[11px] font-semibold uppercase text-blue-700">Root is view-only</span>}
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Name</label>
                        <input
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          disabled={selectedNode.is_root || saving}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Stable key</label>
                        <input
                          value={editKey}
                          onChange={(event) => setEditKey(slugifyNodeKey(event.target.value))}
                          disabled={selectedNode.is_root || saving}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Node kind</label>
                        <select
                          value={editKind}
                          onChange={(event) => setEditKind(event.target.value as HierarchyNodeKind)}
                          disabled={selectedNode.is_root || saving}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                        >
                          {NODE_KIND_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <p className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Behavior</p>
                        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                          <label className="flex items-center gap-2 text-slate-700">
                            <input type="checkbox" checked={editCanHaveChildren} disabled={selectedNode.is_root || saving} onChange={(event) => setEditCanHaveChildren(event.target.checked)} />
                            Can have child nodes
                          </label>
                          {family !== "media" && (
                            <label className="flex items-center gap-2 text-slate-700">
                              <input type="checkbox" checked={editCanContainRecords} disabled={selectedNode.is_root || saving} onChange={(event) => setEditCanContainRecords(event.target.checked)} />
                              Can contain business records
                            </label>
                          )}
                          {family === "media" && (
                            <p className="text-xs text-slate-500">Media hierarchy nodes remain navigation/media containers and are not used for record assignment.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button disabled={saving || selectedNode.is_root} onClick={handleSaveNode} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                        Save node settings
                      </button>
                      <button disabled={saving || selectedNode.is_root} onClick={handleToggleArchive} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                        {selectedNode.is_active ? "Archive node" : "Restore node"}
                      </button>
                      <button disabled={saving || selectedNode.is_root} onClick={() => setDeleteNodeOpen(true)} className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40">
                        Delete node
                      </button>
                    </div>

                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                      <p>Deletes are blocked if the node still has child nodes, linked records, or linked media.</p>
                      {nodeDetails && (
                        <p className="mt-1">Current usage: {nodeDetails.usage.child_nodes} child node(s), {nodeDetails.usage.linked_records} linked record(s), {nodeDetails.usage.linked_media} linked media item(s).</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">Create child node</h4>
                      <p className="mt-1 text-xs text-slate-500">Choose the child behavior first, then provide its name, key, and type.</p>
                    </div>

                    <div className="mt-4 grid gap-2">
                      {availableChildModes.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setChildMode(option.value);
                            setChildKind(option.value === "record" ? "unit" : "folder");
                          }}
                          className={`rounded-lg border px-3 py-3 text-left transition ${childMode === option.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                        >
                          <p className="text-sm font-semibold">{option.label}</p>
                          <p className={`mt-1 text-xs ${childMode === option.value ? "text-white/80" : "text-slate-500"}`}>{option.description}</p>
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Child name</label>
                        <input
                          value={childName}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setChildName(nextValue);
                            setChildKey((current) => (current ? current : slugifyNodeKey(nextValue)));
                          }}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder="Building A"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Stable key</label>
                        <input
                          value={childKey}
                          onChange={(event) => setChildKey(slugifyNodeKey(event.target.value))}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder="building-a"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Node kind</label>
                        <select value={childKind} onChange={(event) => setChildKind(event.target.value as HierarchyNodeKind)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                          {NODE_KIND_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
                        This child will be created as <span className="font-semibold text-slate-800">{behaviorLabel(behaviorFromMode(childMode).canHaveChildren, behaviorFromMode(childMode).canContainRecords)}</span> under <span className="font-semibold text-slate-800">{(selectedNode || rootNode)?.name || `${family} root`}</span>.
                      </div>
                      <button disabled={saving || !childName.trim() || !childKey.trim()} onClick={handleCreateChild} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                        {family === "media" ? "Create folder child" : childMode === "record" ? "Create record-container child" : childMode === "hybrid" ? "Create folder + record child" : "Create folder child"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Field definitions and node overrides</h3>
                <p className="text-xs text-slate-500">Create family-wide fields, then optionally override labels/visibility for the selected node.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{fields.length} active fields</span>
                <button onClick={startCreateField} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  New field
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <div className="space-y-2">
                {fields.length > 0 ? (
                  fields.map((field) => {
                    const selectedForEdit = editingFieldId === field.id;
                    const overrideApplied = hasNodeOverride(field, selectedNode?.id);

                    return (
                      <div key={field.id} className={`rounded-xl border px-4 py-3 text-sm ${selectedForEdit ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium">{field.effective_label}</p>
                              {overrideApplied && <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${selectedForEdit ? "bg-white/15 text-white" : "bg-blue-100 text-blue-700"}`}>Node override</span>}
                              {field.is_system && <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${selectedForEdit ? "bg-white/15 text-white" : "bg-amber-100 text-amber-800"}`}>System</span>}
                            </div>
                            <p className={`mt-1 text-xs ${selectedForEdit ? "text-white/75" : "text-slate-500"}`}>{field.field_key} • {field.storage_kind} • default order {field.display_order_default}</p>
                            <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold uppercase">
                              <span className={`rounded px-2 py-1 ${selectedForEdit ? "bg-white/15 text-white" : field.effective_grid_visible ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400"}`}>Grid</span>
                              <span className={`rounded px-2 py-1 ${selectedForEdit ? "bg-white/15 text-white" : field.effective_intake_visible ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400"}`}>Intake</span>
                              <span className={`rounded px-2 py-1 ${selectedForEdit ? "bg-white/15 text-white" : field.effective_detail_visible ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400"}`}>Detail</span>
                              <span className={`rounded px-2 py-1 ${selectedForEdit ? "bg-white/15 text-white" : field.effective_required ? "bg-amber-100 text-amber-800" : "bg-slate-50 text-slate-400"}`}>Required</span>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => startEditField(field)} className={`rounded-lg border px-3 py-2 text-xs font-medium ${selectedForEdit ? "border-white/30 text-white hover:bg-white/10" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
                              {selectedForEdit ? "Editing" : "Edit"}
                            </button>
                            {overrideApplied && selectedNode && (
                              <button onClick={() => handleResetOverride(field)} disabled={saving} className={`rounded-lg border px-3 py-2 text-xs font-medium ${selectedForEdit ? "border-white/30 text-white hover:bg-white/10" : "border-blue-300 text-blue-700 hover:bg-blue-50"}`}>
                                Reset override
                              </button>
                            )}
                            {!field.is_system && field.storage_kind !== "core_column" && (
                              <button onClick={() => openDeleteFieldModal(field)} disabled={saving} className={`rounded-lg border px-3 py-2 text-xs font-medium ${selectedForEdit ? "border-rose-300 text-white hover:bg-white/10" : "border-rose-300 text-rose-700 hover:bg-rose-50"}`}>
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                    No field metadata exists for this family yet. Create the first field to define grid/intake/detail behavior.
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">{editingField ? `Edit ${editingField.default_label}` : "Create field definition"}</h4>
                      <p className="mt-1 text-xs text-slate-500">Definitions apply to the whole {family} family unless a node override is added below.</p>
                    </div>
                    {editingField && (
                      <button onClick={startCreateField} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-white">
                        Clear form
                      </button>
                    )}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Field key</label>
                      <input value={fieldKeyInput} onChange={(event) => setFieldKeyInput(event.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""))} disabled={saving || Boolean(editingField?.is_system)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100" placeholder="listing_status" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Default label</label>
                      <input value={fieldLabelInput} onChange={(event) => setFieldLabelInput(event.target.value)} disabled={saving} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Listing status" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Data type</label>
                      <select value={fieldTypeInput} onChange={(event) => setFieldTypeInput(event.target.value as FieldDataType)} disabled={saving} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                        {FIELD_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Storage</label>
                      <select value={fieldStorageInput} onChange={(event) => setFieldStorageInput(event.target.value as FieldStorageKind)} disabled={saving || Boolean(editingField?.is_system)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100">
                        {FIELD_STORAGE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Description</label>
                      <textarea value={fieldDescriptionInput} onChange={(event) => setFieldDescriptionInput(event.target.value)} disabled={saving} className="min-h-[84px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Explain where this field is used." />
                    </div>
                    {fieldStorageInput === "core_column" && (
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Core column name</label>
                        <input value={fieldCoreColumnInput} onChange={(event) => setFieldCoreColumnInput(event.target.value)} disabled={saving} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="price" />
                      </div>
                    )}
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Default order</label>
                      <input type="number" value={fieldDisplayOrderInput} onChange={(event) => setFieldDisplayOrderInput(event.target.value)} disabled={saving} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </div>
                    <div className="md:col-span-2 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 sm:grid-cols-2">
                      <label className="flex items-center gap-2"><input type="checkbox" checked={fieldVisibleInput} onChange={(event) => setFieldVisibleInput(event.target.checked)} /> Visible by default</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={fieldRequiredInput} onChange={(event) => setFieldRequiredInput(event.target.checked)} /> Required by default</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={fieldGridVisibleInput} onChange={(event) => setFieldGridVisibleInput(event.target.checked)} /> Show in grid</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={fieldIntakeVisibleInput} onChange={(event) => setFieldIntakeVisibleInput(event.target.checked)} /> Show in intake</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={fieldDetailVisibleInput} onChange={(event) => setFieldDetailVisibleInput(event.target.checked)} /> Show in detail</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={fieldFilterableInput} onChange={(event) => setFieldFilterableInput(event.target.checked)} /> Filterable</label>
                      <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={fieldSortableInput} onChange={(event) => setFieldSortableInput(event.target.checked)} /> Sortable</label>
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Options JSON</label>
                      <textarea value={fieldOptionsInput} onChange={(event) => setFieldOptionsInput(event.target.value)} disabled={saving} className="min-h-[96px] w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Validation JSON</label>
                      <textarea value={fieldValidationInput} onChange={(event) => setFieldValidationInput(event.target.value)} disabled={saving} className="min-h-[96px] w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button onClick={handleSaveFieldDefinition} disabled={saving || !fieldKeyInput.trim() || !fieldLabelInput.trim()} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                      {editingField ? "Save field definition" : "Create field definition"}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Node override</h4>
                    <p className="mt-1 text-xs text-slate-500">Select a field above to override its label or visibility for the currently selected node.</p>
                  </div>

                  {!selectedNode ? (
                    <p className="mt-4 text-sm text-slate-500">Select a node to manage per-node overrides.</p>
                  ) : !editingField ? (
                    <p className="mt-4 text-sm text-slate-500">Choose a field from the list first.</p>
                  ) : (
                    <div className="mt-4 grid gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Override label</label>
                        <input value={overrideLabelInput} onChange={(event) => setOverrideLabelInput(event.target.value)} disabled={saving} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={editingField.default_label} />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Override order</label>
                          <input type="number" value={overrideDisplayOrderInput} onChange={(event) => setOverrideDisplayOrderInput(event.target.value)} disabled={saving} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={String(editingField.display_order_default)} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Width (px)</label>
                          <input type="number" value={overrideWidthInput} onChange={(event) => setOverrideWidthInput(event.target.value)} disabled={saving} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Optional" />
                        </div>
                      </div>
                      <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 sm:grid-cols-2">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={overrideVisibleInput} onChange={(event) => setOverrideVisibleInput(event.target.checked)} /> Visible</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={overrideRequiredInput} onChange={(event) => setOverrideRequiredInput(event.target.checked)} /> Required</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={overrideGridVisibleInput} onChange={(event) => setOverrideGridVisibleInput(event.target.checked)} /> Grid visible</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={overrideIntakeVisibleInput} onChange={(event) => setOverrideIntakeVisibleInput(event.target.checked)} /> Intake visible</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={overrideDetailVisibleInput} onChange={(event) => setOverrideDetailVisibleInput(event.target.checked)} /> Detail visible</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={overrideFilterableInput} onChange={(event) => setOverrideFilterableInput(event.target.checked)} /> Filterable</label>
                        <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={overrideSortableInput} onChange={(event) => setOverrideSortableInput(event.target.checked)} /> Sortable</label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={handleSaveFieldOverride} disabled={saving} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                          Save node override
                        </button>
                        {hasNodeOverride(editingField, selectedNode.id) && (
                          <button onClick={() => handleResetOverride(editingField)} disabled={saving} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                            Reset override
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
      <ConfirmationModal
        open={deleteNodeOpen && Boolean(selectedNode)}
        title={`Delete ${selectedNode?.name || "node"}?`}
        description="This permanently deletes the hierarchy node. Deletion is blocked if the node still has child nodes, linked records, or linked media."
        impacts={[
          `Child nodes: ${nodeDetails?.usage.child_nodes || 0}`,
          `Linked records: ${nodeDetails?.usage.linked_records || 0}`,
          `Linked media: ${nodeDetails?.usage.linked_media || 0}`
        ]}
        confirmLabel="Delete node"
        confirming={saving}
        onClose={() => setDeleteNodeOpen(false)}
        onConfirm={async () => {
          setDeleteNodeOpen(false);
          await handleDelete();
        }}
      />
      <ConfirmationModal
        open={Boolean(deleteFieldTarget)}
        title={`Delete ${deleteFieldTarget?.default_label || "field"}?`}
        description="This permanently deletes the field definition and cascades to its stored custom values and node overrides."
        impacts={
          deleteFieldLoading
            ? ["Loading field delete impact…"]
            : [
                `Stored custom values: ${deleteFieldImpact?.custom_value_count || 0}`,
                `Node overrides: ${deleteFieldImpact?.override_count || 0}`,
                deleteFieldImpact?.hard_delete_allowed === false
                  ? "This field is system/core-backed and cannot be hard deleted."
                  : "Hard delete is allowed for this field."
              ]
        }
        confirmLabel="Delete field"
        confirming={saving}
        onClose={() => {
          setDeleteFieldTarget(null);
          setDeleteFieldImpact(null);
        }}
        onConfirm={async () => {
          if (!deleteFieldTarget || deleteFieldLoading || deleteFieldImpact?.hard_delete_allowed === false) return;
          await handleDeleteField(deleteFieldTarget);
        }}
      />
    </>
  );
}
