"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  const [tree, setTree] = useState<HierarchyTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const selectedNodeId = searchParams.get("nodeId") || "";

  useEffect(() => {
    let active = true;
    async function loadTree() {
      setLoading(true);
      setError("");
      try {
        const result = await fetchHierarchyTreeApi(family);
        if (!active) return;
        setTree(result.tree || []);
      } catch (loadError) {
        if (!active) return;
        setTree([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load hierarchy browser");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadTree();
    return () => {
      active = false;
    };
  }, [family]);

  const visibleTree = useMemo(() => filterTree(tree, activeOnly), [activeOnly, tree]);
  const flatNodes = useMemo(() => flattenTree(visibleTree), [visibleTree]);
  const nodeById = useMemo(() => new Map<string, HierarchyTreeNode>(flatNodes.map((node) => [node.id, node])), [flatNodes]);
  const rootNode = visibleTree[0] || null;
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) || null : null;
  const selectedNodeValid = !recordContainerOnly || isRecordReadyNode(selectedNode);
  const breadcrumbNodes = useMemo(() => buildAncestors(selectedNodeValid ? selectedNode : null, nodeById), [nodeById, selectedNode, selectedNodeValid]);
  const visibleChildren = selectedNodeValid && selectedNode ? selectedNode.children || [] : rootNode?.children || [];


  useEffect(() => {
    if (!selectedNodeId || loading) return;
    if (nodeById.size > 0 && (!nodeById.has(selectedNodeId) || (recordContainerOnly && !isRecordReadyNode(selectedNode)))) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("nodeId");
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
    }
  }, [loading, nodeById, pathname, recordContainerOnly, router, searchParams, selectedNode, selectedNodeId]);

  function updateNode(nodeId?: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (nodeId) next.set("nodeId", nodeId);
    else next.delete("nodeId");
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => updateNode(undefined)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          All records
        </button>
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
          {selectedNodeValid && selectedNode
            ? `Browsing ${selectedNode.path_text}. Records table remains fully searchable/filterable inside this scope.`
            : `Browsing all ${title.toLowerCase()} records. Use the folders below to drill into a specific hierarchy layer.`}
        </p>
      </div>

      {error && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

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
              const childSelectable = !recordContainerOnly || isRecordReadyNode(child);
              return (
              <button
                key={child.id}
                type="button"
                onClick={() => childSelectable && updateNode(child.id)}
                disabled={!childSelectable}
                className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">{child.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{child.node_kind}</p>
                  </div>
                  {!child.allow_record_assignment && <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">container</span>}
                  {recordContainerOnly && !isRecordReadyNode(child) && <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">grid disabled</span>}
                  {!child.is_active && <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">archived</span>}
                </div>
                <p className="mt-3 text-sm text-slate-600 line-clamp-2">{child.path_text}</p>
              </button>
            );})}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
            {selectedNode
              ? "This layer has no child folders. The table below shows the records saved in this branch."
              : "No hierarchy child folders are available yet for this family."}
          </div>
        )}
      </div>
    </section>
  );
}
