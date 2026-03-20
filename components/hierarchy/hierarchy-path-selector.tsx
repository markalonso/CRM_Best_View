"use client";

import { useEffect, useMemo, useState } from "react";
import { HierarchyNodeCreateModal } from "@/components/hierarchy/hierarchy-node-create-modal";
import {
  fetchAllowedHierarchyDestinationsApi,
  fetchHierarchyTreeApi,
  type HierarchyFamily
} from "@/services/api/hierarchy-api.service";
import type { HierarchyNode, HierarchyTreeNode } from "@/types/hierarchy";

type ReviewType = "sale" | "rent" | "buyer" | "client" | "other";
type IntakeHierarchyFamily = Exclude<HierarchyFamily, "media">;

type Props = {
  reviewType: ReviewType;
  selectedNodeId: string;
  canCreate: boolean;
  disabled?: boolean;
  onChange: (nodeId: string) => void;
};

function reviewTypeToFamily(reviewType: ReviewType): IntakeHierarchyFamily | null {
  if (reviewType === "sale") return "sale";
  if (reviewType === "rent") return "rent";
  if (reviewType === "buyer") return "buyers";
  if (reviewType === "client") return "clients";
  return null;
}

function flattenTree(nodes: HierarchyTreeNode[]): HierarchyNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function filterActiveTree(nodes: HierarchyTreeNode[]): HierarchyTreeNode[] {
  return nodes
    .filter((node) => node.is_root || node.is_active)
    .map((node) => ({ ...node, children: filterActiveTree(node.children || []) }));
}

function formatApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to complete the hierarchy request.";
  const normalized = message.toLowerCase();

  if (normalized.includes("row-level security") || normalized.includes("not permitted") || normalized.includes("forbidden")) {
    return "This action is not permitted for your account. Ask an admin to create the destination if needed.";
  }
  if (normalized.includes("container-only")) {
    return "The selected node can only organize child folders. Choose an active record destination instead.";
  }
  if (normalized.includes("root node") || normalized.includes("family root")) {
    return "Choose a child destination under the family root. Records cannot be saved directly to the root node.";
  }
  if (normalized.includes("archived")) {
    return "The selected hierarchy node is archived. Choose an active branch or ask an admin to restore it.";
  }
  return message;
}

function TreeOption({
  node,
  allowedNodeIds,
  selectedNodeId,
  parentNodeId,
  canCreate,
  onBrowse,
  onSelectDestination
}: {
  node: HierarchyTreeNode;
  allowedNodeIds: Set<string>;
  selectedNodeId: string;
  parentNodeId: string;
  canCreate: boolean;
  onBrowse: (node: HierarchyNode) => void;
  onSelectDestination: (node: HierarchyNode) => void;
}) {
  const isSelected = node.id === selectedNodeId;
  const isParent = node.id === parentNodeId;
  const selectable = allowedNodeIds.has(node.id);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onBrowse(node);
          if (selectable) onSelectDestination(node);
        }}
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
          isSelected
            ? "border-slate-900 bg-slate-900 text-white"
            : isParent
              ? "border-blue-300 bg-blue-50 text-slate-800"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        }`}
        style={{ paddingLeft: `${node.depth * 16 + 12}px` }}
      >
        <div className="min-w-0">
          <p className="truncate font-medium">{node.name}</p>
          <p className={`truncate text-xs ${isSelected ? "text-white/80" : isParent ? "text-blue-700" : "text-slate-500"}`}>{node.path_text}</p>
        </div>
        <div className="ml-3 flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${isSelected ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"}`}>
            {node.node_kind}
          </span>
          {selectable ? (
            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${isSelected ? "bg-emerald-200 text-emerald-950" : "bg-emerald-100 text-emerald-800"}`}>
              save target
            </span>
          ) : (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              {canCreate ? "parent only" : "container only"}
            </span>
          )}
          {isParent && !isSelected && canCreate && <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">create here</span>}
        </div>
      </button>
      {node.children.length > 0 && node.children.map((child) => (
        <TreeOption
          key={child.id}
          node={child}
          allowedNodeIds={allowedNodeIds}
          selectedNodeId={selectedNodeId}
          parentNodeId={parentNodeId}
          canCreate={canCreate}
          onBrowse={onBrowse}
          onSelectDestination={onSelectDestination}
        />
      ))}
    </div>
  );
}

export function HierarchyPathSelector({ reviewType, selectedNodeId, canCreate, disabled = false, onChange }: Props) {
  const family = reviewTypeToFamily(reviewType);
  const [tree, setTree] = useState<HierarchyTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [allowedNodeIds, setAllowedNodeIds] = useState<Set<string>>(new Set());
  const [browseNodeId, setBrowseNodeId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const visibleTree = useMemo(() => filterActiveTree(tree), [tree]);
  const flatNodes = useMemo(() => flattenTree(visibleTree), [visibleTree]);
  const nodeById = useMemo(() => new Map<string, HierarchyNode>(flatNodes.map((node) => [node.id, node])), [flatNodes]);
  const selectedNode = selectedNodeId && allowedNodeIds.has(selectedNodeId) ? nodeById.get(selectedNodeId) || null : null;
  const rootNode = visibleTree[0] || null;
  const assignableNodes = flatNodes.filter((node) => allowedNodeIds.has(node.id));
  const browseNode = browseNodeId ? nodeById.get(browseNodeId) || null : null;
  const createParent = browseNode || selectedNode || rootNode || null;
  const createParentLabel = createParent?.path_text || createParent?.name || `${family} root`;
  const canCreateUnderParent = Boolean(createParent?.can_have_children);

  async function loadTree(nextFamily: IntakeHierarchyFamily, preferredNodeId?: string) {
    setLoading(true);
    setError("");
    try {
      const [result, destinationResult] = await Promise.all([
        fetchHierarchyTreeApi(nextFamily),
        fetchAllowedHierarchyDestinationsApi(nextFamily)
      ]);
      const nextTree = filterActiveTree(result.tree || []);
      const allowedIds = new Set((destinationResult.nodes || []).map((node) => node.id));
      const visibleIds = new Set(flattenTree(nextTree).map((node) => node.id));

      setTree(result.tree || []);
      setAllowedNodeIds(allowedIds);

      if (preferredNodeId && (!visibleIds.has(preferredNodeId) || !allowedIds.has(preferredNodeId))) {
        onChange("");
      }

      if (preferredNodeId && visibleIds.has(preferredNodeId)) {
        setBrowseNodeId(preferredNodeId);
      } else if (!browseNodeId && nextTree[0]) {
        setBrowseNodeId(nextTree[0].id);
      }
    } catch (loadError) {
      setTree([]);
      setAllowedNodeIds(new Set());
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setNotice("");
    setError("");
    setCreateOpen(false);
    setBrowseNodeId("");
    if (!family) {
      setTree([]);
      setAllowedNodeIds(new Set());
      if (selectedNodeId) onChange("");
      return;
    }
    loadTree(family, selectedNodeId || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family]);

  useEffect(() => {
    if (!family || !selectedNodeId) return;
    if (flatNodes.length === 0) return;
    const match = flatNodes.find((node) => node.id === selectedNodeId);
    if (!match || !allowedNodeIds.has(selectedNodeId)) onChange("");
  }, [allowedNodeIds, family, flatNodes, onChange, selectedNodeId]);

  useEffect(() => {
    if (browseNodeId && nodeById.has(browseNodeId)) return;
    if (selectedNode && nodeById.has(selectedNode.id)) {
      setBrowseNodeId(selectedNode.id);
      return;
    }
    if (rootNode) setBrowseNodeId(rootNode.id);
  }, [browseNodeId, nodeById, rootNode, selectedNode]);

  if (!family) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        Choose a record type first, then pick the hierarchy path for this intake.
      </div>
    );
  }

  const showNoTargetsMessage = !loading && tree.length > 0 && assignableNodes.length === 0;

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Hierarchy path</h3>
            <p className="mt-1 text-sm text-slate-600">Pick an active record-ready destination before saving. Admins can use Add Folder to extend the path with the same full hierarchy modal used elsewhere.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => loadTree(family, selectedNodeId || browseNodeId || undefined)}
              disabled={loading}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh paths"}
            </button>
            {canCreate && (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setNotice("");
                  setCreateOpen(true);
                }}
                disabled={disabled}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Add Folder
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
                No hierarchy nodes are available for this family yet. {canCreate ? "Use Add Folder to create the family root and then the correct branch/destination path." : "Ask an admin to create the needed path."}
              </div>
            ) : (
              <>
                {showNoTargetsMessage && (
                  <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {canCreate
                      ? "No active save-ready destinations exist yet. Select the parent branch where the record should live, then use Add Folder to create the correct branch or destination node."
                      : "No active save-ready destinations exist yet for this family. Ask an admin to create one before saving this intake."}
                  </div>
                )}
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                  {visibleTree.map((node) => (
                    <TreeOption
                      key={node.id}
                      node={node}
                      allowedNodeIds={allowedNodeIds}
                      selectedNodeId={selectedNodeId}
                      parentNodeId={createParent?.id || ""}
                      canCreate={canCreate}
                      onBrowse={(nextNode) => {
                        setBrowseNodeId(nextNode.id);
                        setNotice("");
                        if (allowedNodeIds.has(nextNode.id)) setError("");
                      }}
                      onSelectDestination={(nextNode) => {
                        setBrowseNodeId(nextNode.id);
                        onChange(nextNode.id);
                        setError("");
                        setNotice("");
                      }}
                    />
                  ))}
                </div>
              </>
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
                    <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-700">record-ready</span>
                  </div>
                </>
              ) : (
                <div className="mt-2 rounded-lg border border-dashed border-amber-300 bg-white p-3 text-sm text-amber-800">
                  No hierarchy destination selected yet. Choose an active save-ready node before saving this intake.
                </div>
              )}
            </div>

            <div className="rounded-lg bg-white p-3 text-sm text-slate-600">
              <p className="font-medium text-slate-800">Available save targets</p>
              <p className="mt-1">{assignableNodes.length} active assignable node{assignableNodes.length === 1 ? "" : "s"} found for this family.</p>
              {!canCreate && <p className="mt-2 text-xs text-slate-500">Only admins can create new destination nodes from intake.</p>}
            </div>

            {canCreate && (
              <div className="rounded-lg bg-white p-3 text-sm text-slate-600">
                <p className="font-medium text-slate-800">Create under branch</p>
                <p className="mt-1">{createParentLabel}</p>
                {!canCreateUnderParent && createParent && (
                  <p className="mt-2 text-xs text-amber-700">This branch is a leaf and cannot contain children. Select another parent branch in the tree first.</p>
                )}
                <p className="mt-2 text-xs text-slate-500">Add Folder opens the shared hierarchy modal with folder-only, record-container, folder + record, and immediate field configuration support.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {canCreate && createOpen && (
        <HierarchyNodeCreateModal
          open={createOpen}
          family={family}
          parentNode={createParent}
          onClose={() => setCreateOpen(false)}
          onRootReady={async (rootNodeId) => {
            await loadTree(family, rootNodeId);
            setBrowseNodeId(rootNodeId);
            setNotice("Family root is ready. You can keep adding the destination path from here.");
          }}
          onCreated={async (node) => {
            const createdIsAssignable = node.is_active && node.can_contain_records && node.allow_record_assignment && !node.is_root;

            await loadTree(family, node.id);
            setBrowseNodeId(node.id);
            setCreateOpen(false);

            if (createdIsAssignable) {
              onChange(node.id);
              setNotice(`Created ${node.name} and selected it as the save destination.`);
              return;
            }

            setNotice(`Created ${node.name}. It is folder-only, so choose a record-ready child before saving.`);
          }}
        />
      )}
    </>
  );
}
