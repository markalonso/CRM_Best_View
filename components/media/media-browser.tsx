"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HierarchyNodeCreateModal } from "@/components/hierarchy/hierarchy-node-create-modal";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { useAuth } from "@/hooks/use-auth";
import { MediaViewerModal } from "@/components/media/media-viewer-modal";
import { deleteHierarchyNodeApi, deleteMediaItemApi, fetchHierarchyNodeDetailsApi } from "@/services/api/hierarchy-api.service";
import type { HierarchyTreeNode } from "@/types/hierarchy";

type MediaFamily = "sale" | "rent" | "buyers" | "clients";
type MediaKind = "all" | "image" | "video" | "document" | "other";

type BrowserMediaItem = {
  id: string;
  file_url: string;
  mime_type: string;
  media_type: "image" | "video" | "document" | "other";
  original_filename: string;
  file_size: number | null;
  created_at: string;
  record_type?: string | null;
  record_id?: string | null;
  hierarchy_node_id?: string | null;
};

type BrowserResponse = {
  family: MediaFamily;
  selectedNodeId: string | null;
  rootNodeId: string | null;
  tree: HierarchyTreeNode[];
  counts: Record<string, { total: number; images: number; videos: number; documents: number }>;
  unassignedCount?: number;
  media: BrowserMediaItem[];
};

const FAMILY_OPTIONS: Array<{ id: MediaFamily; label: string }> = [
  { id: "sale", label: "Sale" },
  { id: "rent", label: "Rent" },
  { id: "buyers", label: "Buyers" },
  { id: "clients", label: "Clients" }
];

function flattenTree(nodes: HierarchyTreeNode[]): HierarchyTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function formatFileSize(size: number | null) {
  if (!size) return "Unknown size";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function relTime(value?: string) {
  if (!value) return "-";
  const diff = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function MediaBrowser() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = (user?.role || "viewer") === "admin";

  const [data, setData] = useState<BrowserResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedNodeUsage, setSelectedNodeUsage] = useState<{ child_nodes: number; linked_records: number; linked_media: number } | null>(null);
  const [deleteNodeOpen, setDeleteNodeOpen] = useState(false);
  const [deleteMediaTarget, setDeleteMediaTarget] = useState<BrowserMediaItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const family = (searchParams.get("family") || "sale") as MediaFamily;
  const nodeId = searchParams.get("nodeId") || "";
  const mediaType = (searchParams.get("mediaType") || "all") as MediaKind;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ family, mediaType });
      if (nodeId) query.set("nodeId", nodeId);
      const response = await fetch(`/api/media/browser?${query.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as BrowserResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to load media browser");
      setData(payload);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "Failed to load media browser");
    } finally {
      setLoading(false);
    }
  }, [family, mediaType, nodeId]);

  useEffect(() => {
    load();
  }, [load]);

  const flatNodes = useMemo(() => flattenTree(data?.tree || []), [data?.tree]);
  const nodeById = useMemo(() => new Map(flatNodes.map((node) => [node.id, node])), [flatNodes]);
  const selectedNode = nodeId ? nodeById.get(nodeId) || null : null;
  const rootNode = data?.tree?.[0] || null;
  const childNodes = selectedNode ? selectedNode.children : rootNode?.children || [];
  const currentParent = selectedNode || rootNode || null;
  const breadcrumbNodes = useMemo(() => {
    const chain: HierarchyTreeNode[] = [];
    let current = selectedNode;
    while (current) {
      chain.unshift(current);
      current = current.parent_id ? nodeById.get(current.parent_id) || null : null;
    }
    return chain;
  }, [nodeById, selectedNode]);
  const currentCounts = selectedNode && data?.counts ? data.counts[selectedNode.id] : null;

  useEffect(() => {
    async function loadNodeUsage() {
      if (!selectedNode || selectedNode.is_root) {
        setSelectedNodeUsage(null);
        return;
      }
      try {
        const details = await fetchHierarchyNodeDetailsApi(selectedNode.id);
        setSelectedNodeUsage(details.usage);
      } catch {
        setSelectedNodeUsage(null);
      }
    }

    loadNodeUsage();
  }, [selectedNode]);

  function updateQuery(next: Partial<{ family: MediaFamily; nodeId: string; mediaType: MediaKind }>) {
    const params = new URLSearchParams(searchParams.toString());
    const nextFamily = next.family || family;
    if (next.family) {
      params.set("family", nextFamily);
      params.delete("nodeId");
    }
    if (next.nodeId !== undefined) {
      if (next.nodeId) params.set("nodeId", next.nodeId);
      else params.delete("nodeId");
    }
    if (next.mediaType) params.set("mediaType", next.mediaType);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function handleTreeChanged(nextNodeId?: string) {
    await load();
    if (nextNodeId !== undefined) updateQuery({ nodeId: nextNodeId });
  }

  async function handleDeleteCurrentNode() {
    if (!selectedNode) return;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      await deleteHierarchyNodeApi(selectedNode.id);
      setNotice(`Deleted ${selectedNode.name}.`);
      setDeleteNodeOpen(false);
      await load();
      updateQuery({ nodeId: selectedNode.parent_id || "" });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete media folder");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteMedia() {
    if (!deleteMediaTarget) return;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const result = await deleteMediaItemApi(deleteMediaTarget.id);
      setNotice(result.storageWarnings.length > 0
        ? `Deleted ${deleteMediaTarget.original_filename || "media item"} with storage cleanup warnings.`
        : `Deleted ${deleteMediaTarget.original_filename || "media item"}.`);
      setDeleteMediaTarget(null);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete media item");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <section className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Media</h2>
              <p className="mt-1 text-sm text-slate-600">Browse media by family and hierarchy path while keeping preview/download behavior intact.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {FAMILY_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => updateQuery({ family: option.id, nodeId: "" })}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${family === option.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {option.label}
                </button>
              ))}
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
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" onClick={() => updateQuery({ nodeId: "" })} className={`rounded-full px-3 py-1 ${!selectedNode ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
              All {FAMILY_OPTIONS.find((option) => option.id === family)?.label} media
            </button>
            {breadcrumbNodes.map((node) => (
              <div key={node.id} className="flex items-center gap-2">
                <span className="text-slate-400">/</span>
                <button
                  type="button"
                  onClick={() => updateQuery({ nodeId: node.id })}
                  className={`rounded-full px-3 py-1 ${selectedNode?.id === node.id ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
                >
                  {node.name}
                </button>
              </div>
            ))}
          </div>

          {(error || notice) && <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || notice}</div>}

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Child folders</h3>
                  <p className="text-xs text-slate-500">Counts reflect media saved in each branch when available.</p>
                </div>
                {loading && <span className="text-xs text-slate-500">Loading…</span>}
              </div>

              {loading ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />)}
                </div>
              ) : childNodes.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {childNodes.map((child) => {
                    const counts = data?.counts?.[child.id] || { total: 0, images: 0, videos: 0, documents: 0 };
                    return (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => updateQuery({ nodeId: child.id })}
                        className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">{child.name}</p>
                            <p className="mt-1 text-xs text-slate-500">{child.node_kind}</p>
                          </div>
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{counts.total} files</span>
                        </div>
                        <p className="mt-3 line-clamp-2 text-sm text-slate-600">{child.path_text}</p>
                        <p className="mt-3 text-xs text-slate-500">📷 {counts.images} • 🎥 {counts.videos} • 📄 {counts.documents}</p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                  {selectedNode ? "This hierarchy layer has no child folders. The gallery below shows media already saved in this branch." : "No hierarchy folders are available for this family yet."}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current scope</p>
              <p className="mt-2 text-base font-semibold text-slate-900">{selectedNode ? selectedNode.name : `All ${family} media`}</p>
              <p className="mt-1 text-sm text-slate-600">{selectedNode ? selectedNode.path_text : "Showing all hierarchy-linked media for this family."}</p>
              {isAdmin && !authLoading && (
                <p className="mt-2 text-xs text-slate-500">New child nodes will be created under <span className="font-semibold text-slate-700">{currentParent?.path_text || currentParent?.name || family}</span>.</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {(["all", "image", "video", "document", "other"] as MediaKind[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => updateQuery({ mediaType: option })}
                    className={`rounded-full px-3 py-1 ${mediaType === option ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="mt-4 rounded-lg bg-white p-3 text-sm text-slate-600">
                <p className="font-medium text-slate-800">Media counts</p>
                <p className="mt-1">{currentCounts ? `${currentCounts.total} files in this branch` : `${data?.media.length || 0} files loaded`}</p>
                {!selectedNode && (data?.unassignedCount || 0) > 0 && <p className="mt-2 text-xs text-amber-700">Includes {data?.unassignedCount || 0} unassigned legacy file(s).</p>}
                <p className="mt-2 text-xs text-slate-500">Preview, open, and download remain available for every file.</p>
              </div>
              {isAdmin && selectedNode && !selectedNode.is_root && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <p className="font-medium text-rose-900">Delete current folder</p>
                  <p className="mt-1 text-xs">
                    Hard delete is blocked when this folder still has child folders, linked records, or linked media.
                  </p>
                  <button
                    type="button"
                    onClick={() => setDeleteNodeOpen(true)}
                    className="mt-3 rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
                  >
                    Delete folder
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Media gallery</h3>
              <p className="mt-1 text-sm text-slate-600">{selectedNode ? "Showing media from the selected node and its descendants." : "Showing all hierarchy-linked media for the selected family."}</p>
            </div>
            {error && <span className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</span>}
          </div>

          {loading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-48 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />)}
            </div>
          ) : data && data.media.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {data.media.map((item, index) => (
                <div key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button type="button" onClick={() => setActiveIndex(index)} className="block w-full text-left">
                    {item.media_type === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.file_url} alt={item.original_filename || "media"} className="h-40 w-full object-cover" />
                    ) : item.media_type === "video" ? (
                      <div className="flex h-40 items-center justify-center bg-slate-950 text-sm font-medium text-white">Video preview</div>
                    ) : (
                      <div className="flex h-40 items-center justify-center bg-slate-100 text-sm font-medium text-slate-700">{item.media_type}</div>
                    )}
                  </button>
                  <div className="space-y-3 p-3">
                    <div>
                      <p className="truncate text-sm font-semibold text-slate-900">{item.original_filename || item.media_type}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatFileSize(item.file_size)} • {relTime(item.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <button type="button" onClick={() => setActiveIndex(index)} className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50">Preview</button>
                      <a href={item.file_url} target="_blank" rel="noreferrer" className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50">Open</a>
                      <a href={item.file_url} download className="rounded bg-slate-900 px-2 py-1 text-white">Download</a>
                      {isAdmin && (
                        <button type="button" onClick={() => setDeleteMediaTarget(item)} className="rounded border border-rose-300 px-2 py-1 text-rose-700 hover:bg-rose-50">
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              No media files found for this family/path yet.
            </div>
          )}
        </section>

        {data && activeIndex !== null && data.media[activeIndex] && (
          <MediaViewerModal
            items={data.media}
            index={activeIndex}
            onClose={() => setActiveIndex(null)}
            onPrev={() => setActiveIndex((current) => (current === null ? 0 : (current - 1 + data.media.length) % data.media.length))}
            onNext={() => setActiveIndex((current) => (current === null ? 0 : (current + 1) % data.media.length))}
          />
        )}
      </section>

      {isAdmin && !authLoading && (
        <HierarchyNodeCreateModal
          open={createOpen}
          family={family}
          parentNode={currentParent}
          onClose={() => setCreateOpen(false)}
          onRootReady={async () => {
            await handleTreeChanged(nodeId || undefined);
          }}
          onCreated={async (node, options) => {
            await handleTreeChanged(options.openCreatedNode ? node.id : nodeId || "");
            setNotice(options.openCreatedNode ? `Created ${node.name} and opened it.` : `Created ${node.name} under ${currentParent?.name || family}.`);
          }}
        />
      )}
      <ConfirmationModal
        open={deleteNodeOpen && Boolean(selectedNode)}
        title={`Delete ${selectedNode?.name || "folder"}?`}
        description="This permanently deletes the media folder node. Deletion is blocked when the folder still has child folders, linked records, or linked media."
        impacts={[
          `Child folders: ${selectedNodeUsage?.child_nodes || 0}`,
          `Linked records: ${selectedNodeUsage?.linked_records || 0}`,
          `Linked media: ${selectedNodeUsage?.linked_media || 0}`
        ]}
        confirmLabel="Delete folder"
        confirming={deleting}
        onClose={() => setDeleteNodeOpen(false)}
        onConfirm={handleDeleteCurrentNode}
      />
      <ConfirmationModal
        open={Boolean(deleteMediaTarget)}
        title={`Delete ${deleteMediaTarget?.original_filename || "media item"}?`}
        description="This permanently deletes the media database row, removes hierarchy references via cascade, and attempts to delete the backing storage object."
        impacts={[
          `Media type: ${deleteMediaTarget?.media_type || "-"}`,
          `Linked record: ${deleteMediaTarget?.record_type && deleteMediaTarget?.record_id ? `${deleteMediaTarget.record_type} / ${deleteMediaTarget.record_id}` : "none"}`,
          `Hierarchy node: ${deleteMediaTarget?.hierarchy_node_id || "none"}`
        ]}
        confirmLabel="Delete media"
        confirming={deleting}
        onClose={() => setDeleteMediaTarget(null)}
        onConfirm={handleDeleteMedia}
      />
    </>
  );
}
