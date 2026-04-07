"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HierarchyNodeCreateModal } from "@/components/hierarchy/hierarchy-node-create-modal";
import { useAuth } from "@/hooks/use-auth";
import { fetchHierarchyTreeApi, type HierarchyFamily } from "@/services/api/hierarchy-api.service";
import type { HierarchyTreeNode } from "@/types/hierarchy";

type Props = {
  family: Exclude<HierarchyFamily, "media">;
  title: string;
  description: string;
  activeOnly?: boolean;
  recordContainerOnly?: boolean;
};

function flattenTree(nodes: HierarchyTreeNode[]): HierarchyTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function filterTree(nodes: HierarchyTreeNode[], activeOnly: boolean): HierarchyTreeNode[] {
  return nodes
    .filter((node) => !activeOnly || node.is_active || node.is_root)
    .map((node) => ({ ...node, children: filterTree(node.children || [], activeOnly) }));
}

function isRecordReadyNode(node: HierarchyTreeNode | null) {
  return Boolean(node && node.is_active && !node.is_root && node.can_contain_records && node.allow_record_assignment);
}

function buildAncestors(node: HierarchyTreeNode | null, byId: Map<string, HierarchyTreeNode>) {
  const chain: HierarchyTreeNode[] = [];
  let current = node;
  while (current) {
    chain.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) || null : null;
  }
  return chain;
}

export function FamilyHierarchyBrowser({ family, title, description, activeOnly = false, recordContainerOnly = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = (user?.role || "viewer") === "admin";

  const [tree, setTree] = useState<HierarchyTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const selectedNodeId = searchParams.get("nodeId") || "";
  const archiveScope = (searchParams.get("archiveScope") || "active").toLowerCase();

  const loadTree = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchHierarchyTreeApi(family);
      setTree(result.tree || []);
    } catch (loadError) {
      setTree([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load hierarchy browser");
    } finally {
      setLoading(false);
    }
  }, [family]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const visibleTree = useMemo(() => filterTree(tree, activeOnly), [activeOnly, tree]);
  const flatNodes = useMemo(() => flattenTree(visibleTree), [visibleTree]);
  const nodeById = useMemo(() => new Map<string, HierarchyTreeNode>(flatNodes.map((node) => [node.id, node])), [flatNodes]);
  const rootNode = visibleTree[0] || null;
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) || null : null;
  const breadcrumbNodes = useMemo(() => buildAncestors(selectedNode, nodeById), [nodeById, selectedNode]);
  const visibleChildren = selectedNode ? selectedNode.children || [] : rootNode?.children || [];
  const currentParent = selectedNode || rootNode || null;

  useEffect(() => {
    if (!selectedNodeId || loading) return;
    if (nodeById.size > 0 && !nodeById.has(selectedNodeId)) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("nodeId");
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
    }
  }, [loading, nodeById, pathname, router, searchParams, selectedNodeId]);

  function updateNode(nodeId?: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (nodeId) next.set("nodeId", nodeId);
    else next.delete("nodeId");
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
  }

  function updateArchive(scope: "active" | "archived", options?: { keepNode?: boolean }) {
    const next = new URLSearchParams(searchParams.toString());
    if (scope === "active") next.delete("archiveScope");
    else next.set("archiveScope", scope);
    if (!options?.keepNode) next.delete("nodeId");
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
  }

  async function handleNodeCreated(nodeId?: string) {
    await loadTree();
    if (nodeId) updateNode(nodeId);
  }

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && !authLoading && (
              <button
                type="button"
                onClick={() => {
                  setNotice("");
                  setCreateOpen(true);
                }}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Add Folder
              </button>
            )}
            <button
              type="button"
              onClick={() => updateNode(undefined)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              All records
            </button>
            <button
              type="button"
              onClick={() => updateArchive("active", { keepNode: true })}
              className={`rounded-lg border px-3 py-2 text-sm ${archiveScope === "active" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
            >
              Active view
            </button>
            {selectedNode && (
              <button
                type="button"
                onClick={() => updateArchive("archived", { keepNode: true })}
                className={`rounded-lg border px-3 py-2 text-sm ${archiveScope === "archived" ? "border-amber-600 bg-amber-600 text-white" : "border-amber-300 text-amber-800 hover:bg-amber-50"}`}
              >
                Folder archive
              </button>
            )}
            <button
              type="button"
              onClick={() => updateArchive("archived", { keepNode: false })}
              className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-800 hover:bg-amber-50"
            >
              Family archive
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" onClick={() => updateNode(undefined)} className={`rounded-full px-3 py-1 ${!selectedNode ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-300"}`}>
              {title}
            </button>
            {breadcrumbNodes.map((node) => (
              <div key={node.id} className="flex items-center gap-2">
                <span className="text-slate-400">/</span>
                <button
                  type="button"
                  onClick={() => updateNode(node.id)}
                  className={`rounded-full px-3 py-1 ${selectedNode?.id === node.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-300"}`}
                >
                  {node.name}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {selectedNode
              ? `Browsing ${selectedNode.path_text}. The records grid stays filtered to this branch and its descendants${archiveScope === "archived" ? " in archive mode" : ""}.`
              : `Browsing all ${title.toLowerCase()} records${archiveScope === "archived" ? " in family archive mode" : ""}. Use the folders below to drill into a specific hierarchy layer.`}
          </p>
          {isAdmin && !authLoading && (
            <p className="mt-2 text-xs text-slate-500">
              New child nodes will be created under <span className="font-semibold text-slate-700">{currentParent?.path_text || currentParent?.name || title}</span>.
            </p>
          )}
        </div>

        {(error || notice) && <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || notice}</div>}

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Child folders</h3>
              <p className="text-xs text-slate-500">Open the next layer without losing the existing grid/filter tools.</p>
            </div>
            {loading && <span className="text-xs text-slate-500">Loading…</span>}
          </div>

          {loading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
              ))}
            </div>
          ) : visibleChildren.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {visibleChildren.map((child) => {
                const childRecordReady = isRecordReadyNode(child);
                return (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => updateNode(child.id)}
                    className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900">{child.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{child.node_kind}</p>
                      </div>
                      {!childRecordReady && <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">container</span>}
                      {recordContainerOnly && childRecordReady && <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">record ready</span>}
                      {!child.is_active && <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">archived</span>}
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-slate-600">{child.path_text}</p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              {selectedNode
                ? "This layer has no child folders. The table below shows the records saved in this branch and its descendants."
                : "No hierarchy child folders are available yet for this family."}
            </div>
          )}
        </div>
      </section>

      {isAdmin && !authLoading && (
        <HierarchyNodeCreateModal
          open={createOpen}
          family={family}
          parentNode={currentParent}
          onClose={() => setCreateOpen(false)}
          onRootReady={async () => {
            await handleNodeCreated(selectedNodeId || undefined);
          }}
          onCreated={async (node, options) => {
            await handleNodeCreated(options.openCreatedNode ? node.id : selectedNodeId || undefined);
            setNotice(options.openCreatedNode ? `Created ${node.name} and opened it.` : `Created ${node.name} under ${currentParent?.name || title}.`);
          }}
        />
      )}
    </>
  );
}
