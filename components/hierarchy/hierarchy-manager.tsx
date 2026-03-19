"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  createHierarchyNodeApi,
  deleteHierarchyNodeApi,
  fetchFieldDefinitionsApi,
  fetchHierarchyTreeApi,
  updateHierarchyNodeApi,
  type HierarchyFamily,
  type HierarchyNodeKind
} from "@/services/api/hierarchy-api.service";
import type { EffectiveFieldDefinition, HierarchyNode, HierarchyTreeNode } from "@/types/hierarchy";

const FAMILY_OPTIONS: Array<{ id: HierarchyFamily; label: string }> = [
  { id: "sale", label: "Sale" },
  { id: "rent", label: "Rent" },
  { id: "buyers", label: "Buyers" },
  { id: "clients", label: "Clients" },
  { id: "media", label: "Media" }
];

const NODE_KIND_OPTIONS: HierarchyNodeKind[] = ["folder", "project", "building", "unit", "phase", "custom"];

function flattenTree(nodes: HierarchyTreeNode[]): HierarchyNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function TreeRow({ node, selectedId, onSelect }: { node: HierarchyTreeNode; selectedId: string; onSelect: (node: HierarchyNode) => void }) {
  const isSelected = node.id === selectedId;
  return (
    <div>
      <button
        onClick={() => onSelect(node)}
        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${isSelected ? "bg-slate-900 text-white" : "hover:bg-slate-100 text-slate-700"}`}
        style={{ paddingLeft: `${node.depth * 18 + 12}px` }}
      >
        <span className="truncate">{node.name}</span>
        <span className={`ml-3 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${isSelected ? "bg-white/15 text-white" : node.is_active ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"}`}>
          {node.node_kind}
        </span>
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [editName, setEditName] = useState("");
  const [editKey, setEditKey] = useState("");
  const [childName, setChildName] = useState("");
  const [childKey, setChildKey] = useState("");
  const [childKind, setChildKind] = useState<HierarchyNodeKind>("folder");

  const flatNodes = useMemo(() => flattenTree(tree), [tree]);
  const selectedNode = flatNodes.find((node) => node.id === selectedId) || null;
  const rootNode = tree[0] || null;

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
        const nodeFields = await fetchFieldDefinitionsApi(nextFamily, nextSelected);
        setFields(nodeFields.fields || []);
      } else {
        setFields(fieldsResult.fields || []);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load hierarchy");
      setTree([]);
      setFields([]);
      setSelectedId("");
    } finally {
      setLoading(false);
    }
  }

  async function loadFields(nodeId: string, nextFamily = family) {
    try {
      const result = await fetchFieldDefinitionsApi(nextFamily, nodeId);
      setFields(result.fields || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load field definitions");
      setFields([]);
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
      return;
    }
    setEditName(selectedNode.name);
    setEditKey(selectedNode.node_key);
  }, [selectedNode]);

  async function handleSelect(node: HierarchyNode) {
    setSelectedId(node.id);
    setNotice("");
    setError("");
    await loadFields(node.id);
  }

  async function handleRename() {
    if (!selectedNode) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateHierarchyNodeApi(selectedNode.id, {
        name: editName,
        nodeKey: editKey
      });
      setNotice(`Updated ${result.node.name}.`);
      await loadTree(family, result.node.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update node");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleArchive() {
    if (!selectedNode) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateHierarchyNodeApi(selectedNode.id, {
        isActive: !selectedNode.is_active
      });
      setNotice(result.node.is_active ? `Reactivated ${result.node.name}.` : `Archived ${result.node.name}.`);
      await loadTree(family, result.node.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to archive node");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateChild() {
    const parent = selectedNode || rootNode;
    if (!parent || !childName.trim() || !childKey.trim()) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await createHierarchyNodeApi({
        family,
        parentId: parent.id,
        nodeKind: childKind,
        name: childName,
        nodeKey: childKey,
        allowRecordAssignment: childKind !== "project" && childKind !== "building"
      });
      setChildName("");
      setChildKey("");
      setChildKind("folder");
      setNotice(`Created ${result.node.name}.`);
      await loadTree(family, result.node.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to create node");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedNode) return;
    const confirmed = window.confirm(`Delete ${selectedNode.name}? This only works when the node is empty.`);
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
            <p className="mt-1 text-sm text-slate-600">Manage reusable deep folders/layers for sale, rent, buyers, clients, and media.</p>
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
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{FAMILY_OPTIONS.find((item) => item.id === family)?.label} tree</h3>
              <p className="text-xs text-slate-500">Browse and select a node to edit it.</p>
            </div>
            <button onClick={() => loadTree(family, selectedId || undefined)} className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Loading hierarchy…</p>
          ) : tree.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              No nodes were returned for this family yet. Seed a root node first, then create children here.
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
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{selectedNode?.name || "No node selected"}</h3>
                <p className="mt-1 text-sm text-slate-600">{selectedNode ? selectedNode.path_text : "Select a node from the tree to rename, archive, or create children."}</p>
              </div>
              {selectedNode && (
                <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${selectedNode.is_active ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                  {selectedNode.is_active ? "Active" : "Archived"}
                </span>
              )}
            </div>

            {selectedNode ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Name</label>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Stable key</label>
                    <input value={editKey} onChange={(e) => setEditKey(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button disabled={saving} onClick={handleRename} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">Save node</button>
                    <button disabled={saving} onClick={handleToggleArchive} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                      {selectedNode.is_active ? "Archive node" : "Reactivate node"}
                    </button>
                    <button disabled={saving} onClick={handleDelete} className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40">Delete if empty</button>
                  </div>
                  <p className="text-xs text-slate-500">Deletes are blocked if the node still has child nodes, records, or media linked to it.</p>
                </div>

                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="text-sm font-semibold text-slate-800">Create child node</h4>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Child name</label>
                    <input value={childName} onChange={(e) => setChildName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Building A" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Child key</label>
                    <input value={childKey} onChange={(e) => setChildKey(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="building-a" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Node kind</label>
                    <select value={childKind} onChange={(e) => setChildKind(e.target.value as HierarchyNodeKind)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                      {NODE_KIND_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  <button disabled={saving || !childName.trim() || !childKey.trim()} onClick={handleCreateChild} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                    Create child node
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Choose a family and select a node from the tree to start editing.
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
