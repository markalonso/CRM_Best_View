"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createHierarchyNodeApi,
  fetchHierarchyTreeApi,
  type HierarchyFamily,
  type HierarchyNodeKind
} from "@/services/api/hierarchy-api.service";
import type { HierarchyNode, HierarchyTreeNode } from "@/types/hierarchy";

type ReviewType = "sale" | "rent" | "buyer" | "client" | "other";

type Props = {
  reviewType: ReviewType;
  selectedNodeId: string;
  canCreate: boolean;
  disabled?: boolean;
  onChange: (nodeId: string) => void;
};

const NODE_KIND_OPTIONS: Array<{ value: HierarchyNodeKind; label: string }> = [
  { value: "folder", label: "Folder" },
  { value: "project", label: "Project" },
  { value: "building", label: "Building" },
  { value: "unit", label: "Unit" },
  { value: "phase", label: "Phase" },
  { value: "custom", label: "Custom" }
];

function reviewTypeToFamily(reviewType: ReviewType): HierarchyFamily | null {
  if (reviewType === "sale") return "sale";
  if (reviewType === "rent") return "rent";
  if (reviewType === "buyer") return "buyers";
  if (reviewType === "client") return "clients";
  return null;
}

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

function TreeOption({
  node,
  selectedNodeId,
  onSelect
}: {
  node: HierarchyTreeNode;
  selectedNodeId: string;
  onSelect: (node: HierarchyNode) => void;
}) {
  const isSelected = node.id === selectedNodeId;
  const selectable = node.allow_record_assignment && node.is_active;

  return (
    <div>
      <button
        type="button"
        onClick={() => selectable && onSelect(node)}
        disabled={!selectable}
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
          isSelected
            ? "border-slate-900 bg-slate-900 text-white"
            : selectable
              ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              : "border-slate-100 bg-slate-50 text-slate-400"
        } disabled:cursor-not-allowed`}
        style={{ paddingLeft: `${node.depth * 16 + 12}px` }}
      >
        <div className="min-w-0">
          <p className="truncate font-medium">{node.name}</p>
          <p className={`truncate text-xs ${isSelected ? "text-white/80" : "text-slate-500"}`}>{node.path_text}</p>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${isSelected ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"}`}>
            {node.node_kind}
          </span>
          {!node.allow_record_assignment && <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">container only</span>}
          {!node.is_active && <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">archived</span>}
        </div>
      </button>
      {node.children.length > 0 && node.children.map((child) => <TreeOption key={child.id} node={child} selectedNodeId={selectedNodeId} onSelect={onSelect} />)}
    </div>
  );
}

export function HierarchyPathSelector({ reviewType, selectedNodeId, canCreate, disabled = false, onChange }: Props) {
  const family = reviewTypeToFamily(reviewType);
  const [tree, setTree] = useState<HierarchyTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createKey, setCreateKey] = useState("");
  const [createKind, setCreateKind] = useState<HierarchyNodeKind>("folder");
  const [creating, setCreating] = useState(false);

  const flatNodes = useMemo(() => flattenTree(tree), [tree]);
  const selectedNode = flatNodes.find((node) => node.id === selectedNodeId) || null;
  const rootNode = tree[0] || null;
  const assignableNodes = flatNodes.filter((node) => node.allow_record_assignment && node.is_active);
  const createParent = selectedNode || rootNode || null;
  const createParentLabel = createParent?.name || `${family} root`;

  async function loadTree(nextFamily: HierarchyFamily, preferredNodeId?: string) {
    setLoading(true);
    setError("");
    try {
      const result = await fetchHierarchyTreeApi(nextFamily);
      setTree(result.tree || []);
      const availableIds = new Set((result.nodes || []).map((node) => node.id));
      if (preferredNodeId && !availableIds.has(preferredNodeId)) {
        onChange("");
      }
    } catch (loadError) {
      setTree([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load hierarchy paths");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setNotice("");
    setError("");
    if (!family) {
      setTree([]);
      if (selectedNodeId) onChange("");
      return;
    }
    loadTree(family, selectedNodeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family]);

  useEffect(() => {
    if (!family || !selectedNodeId) return;
    if (flatNodes.length === 0) return;
    const match = flatNodes.find((node) => node.id === selectedNodeId);
    if (!match) onChange("");
  }, [family, flatNodes, onChange, selectedNodeId]);

  async function handleCreateNode() {
    if (!family || !createName.trim() || !createKey.trim()) return;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const result = await createHierarchyNodeApi({
        family,
        parentId: createParent?.id,
        name: createName.trim(),
        nodeKey: createKey.trim(),
        nodeKind: createKind,
        allowRecordAssignment: createKind !== "project" && createKind !== "building"
      });
      setNotice(`Created ${result.node.name}.`);
      setCreateName("");
      setCreateKey("");
      setCreateKind("folder");
      setCreateOpen(false);
      await loadTree(family, result.node.id);
      onChange(result.node.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create hierarchy node");
    } finally {
      setCreating(false);
    }
  }

  if (!family) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        Choose a record type first, then pick the hierarchy path for this intake.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Hierarchy path</h3>
          <p className="mt-1 text-sm text-slate-600">Pick the exact folder/location where this {reviewType} record belongs before saving.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadTree(family, selectedNodeId || undefined)}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh paths"}
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => setCreateOpen((value) => !value)}
              disabled={disabled}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {createOpen ? "Cancel new node" : "Create node here"}
            </button>
          )}
        </div>
      </div>

      {(error || notice) && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {error || notice}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Loading hierarchy paths…</div>
          ) : tree.length === 0 ? (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
              No hierarchy nodes are available for this family yet. {canCreate ? "Create one from here to continue." : "Ask an admin to create the needed path."}
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
              {tree.map((node) => (
                <TreeOption key={node.id} node={node} selectedNodeId={selectedNodeId} onSelect={(node) => onChange(node.id)} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected destination</p>
            {selectedNode ? (
              <>
                <p className="mt-2 text-base font-semibold text-slate-900">{selectedNode.name}</p>
                <p className="mt-1 text-sm text-slate-600">{selectedNode.path_text}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase">
                  <span className="rounded bg-slate-200 px-2 py-1 text-slate-700">{selectedNode.node_kind}</span>
                  <span className={`rounded px-2 py-1 ${selectedNode.allow_record_assignment ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                    {selectedNode.allow_record_assignment ? "record-ready" : "container only"}
                  </span>
                </div>
              </>
            ) : (
              <div className="mt-2 rounded-lg border border-dashed border-amber-300 bg-white p-3 text-sm text-amber-800">
                No hierarchy node selected yet. Choose an active destination node before saving this intake.
              </div>
            )}
          </div>

          <div className="rounded-lg bg-white p-3 text-sm text-slate-600">
            <p className="font-medium text-slate-800">Available save targets</p>
            <p className="mt-1">{assignableNodes.length} active assignable node{assignableNodes.length === 1 ? "" : "s"} found for this family.</p>
            {!canCreate && <p className="mt-2 text-xs text-slate-500">Only admins can create new nodes from intake.</p>}
          </div>

          {canCreate && createOpen && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-sm font-semibold text-slate-800">Create child under {createParentLabel}</p>
              <p className="mt-1 text-xs text-slate-500">Use this only when the needed destination does not already exist.</p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Node name</label>
                  <input
                    value={createName}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      setCreateName(nextName);
                      setCreateKey((current) => (current ? current : slugifyNodeKey(nextName)));
                    }}
                    placeholder="Unit 101"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Stable key</label>
                  <input
                    value={createKey}
                    onChange={(e) => setCreateKey(slugifyNodeKey(e.target.value))}
                    placeholder="unit-101"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Node kind</label>
                  <select value={createKind} onChange={(e) => setCreateKind(e.target.value as HierarchyNodeKind)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {NODE_KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleCreateNode}
                  disabled={creating || !createName.trim() || !createKey.trim()}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create and select node"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
