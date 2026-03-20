"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  archiveHierarchyNodeApi,
  createHierarchyNodeApi,
  deleteHierarchyNodeApi,
  ensureHierarchyRootApi,
  fetchFieldDefinitionsApi,
  fetchHierarchyNodeDetailsApi,
  fetchHierarchyTreeApi,
  updateHierarchyNodeApi,
  type HierarchyFamily,
  type HierarchyNodeKind
} from "@/services/api/hierarchy-api.service";
import type { EffectiveFieldDefinition, HierarchyNode, HierarchyNodeDetails, HierarchyTreeNode } from "@/types/hierarchy";

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

  const [editName, setEditName] = useState("");
  const [editKey, setEditKey] = useState("");
  const [editKind, setEditKind] = useState<HierarchyNodeKind>("folder");
  const [editCanHaveChildren, setEditCanHaveChildren] = useState(true);
  const [editCanContainRecords, setEditCanContainRecords] = useState(false);

  const [childName, setChildName] = useState("");
  const [childKey, setChildKey] = useState("");
  const [childKind, setChildKind] = useState<HierarchyNodeKind>("folder");
  const [childMode, setChildMode] = useState<NodeMutationMode>("folder");

  const flatNodes = useMemo(() => flattenTree(tree), [tree]);
  const selectedNode = flatNodes.find((node) => node.id === selectedId) || null;
  const rootNode = tree[0] || null;
  const selectedAssignable = Boolean(selectedNode && selectedNode.allow_record_assignment && selectedNode.is_active && !selectedNode.is_root);
  const availableChildModes = family === "media" ? CHILD_MODE_OPTIONS.filter((option) => option.value === "folder") : CHILD_MODE_OPTIONS;

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
    const confirmed = window.confirm(`Delete ${selectedNode.name}? This only works when the node has no child nodes, records, or media.`);
    if (!confirmed) return;

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
                      <button disabled={saving || selectedNode.is_root} onClick={handleDelete} className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40">
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
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Effective fields for selected node</h3>
                <p className="text-xs text-slate-500">This preview reflects the resolved labels and visibility metadata returned by the backend.</p>
              </div>
              {selectedNode && <span className="text-xs text-slate-500">{fields.length} fields</span>}
            </div>
            <div className="mt-4 space-y-2">
              {selectedNode && fields.length > 0 ? (
                fields.slice(0, 12).map((field) => (
                  <div key={field.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{field.effective_label}</p>
                      <p className="text-xs text-slate-500">{field.field_key} • {field.storage_kind}</p>
                    </div>
                    <div className="flex gap-2 text-[10px] font-semibold uppercase">
                      <span className={`rounded px-2 py-1 ${field.effective_grid_visible ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400"}`}>Grid</span>
                      <span className={`rounded px-2 py-1 ${field.effective_intake_visible ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400"}`}>Intake</span>
                      <span className={`rounded px-2 py-1 ${field.effective_required ? "bg-amber-100 text-amber-800" : "bg-slate-50 text-slate-400"}`}>Required</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">{selectedNode ? "No field metadata found for this node/family yet." : "Select a node to preview its effective fields."}</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
