import type { EffectiveFieldDefinition, HierarchyNode, HierarchyNodeDetails, HierarchyTreeNode } from "@/types/hierarchy";

export type HierarchyFamily = "sale" | "rent" | "buyers" | "clients" | "media";
export type HierarchyNodeKind = "root" | "folder" | "project" | "building" | "unit" | "phase" | "custom";

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    const message = typeof (data as { error?: string }).error === "string" ? (data as { error?: string }).error : "Request failed";
    throw new Error(message);
  }
  return data;
}

export async function fetchHierarchyTreeApi(family: HierarchyFamily) {
  const response = await fetch(`/api/hierarchy/tree?family=${encodeURIComponent(family)}`, { cache: "no-store" });
  return readJson<{ nodes: HierarchyNode[]; tree: HierarchyTreeNode[] }>(response);
}

export async function createHierarchyNodeApi(input: {
  family: HierarchyFamily;
  parentId?: string | null;
  nodeKind: HierarchyNodeKind;
  nodeKey: string;
  name: string;
  sortOrder?: number;
  allowRecordAssignment?: boolean;
  mutationMode?: "folder" | "record" | "hybrid";
  canHaveChildren?: boolean;
  canContainRecords?: boolean;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const response = await fetch("/api/hierarchy/nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<{ ok: true; node: HierarchyNode }>(response);
}

export async function updateHierarchyNodeApi(nodeId: string, input: {
  nodeKind?: HierarchyNodeKind;
  nodeKey?: string;
  name?: string;
  sortOrder?: number;
  allowRecordAssignment?: boolean;
  mutationMode?: "folder" | "record" | "hybrid";
  canHaveChildren?: boolean;
  canContainRecords?: boolean;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const response = await fetch(`/api/hierarchy/nodes/${nodeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<{ ok: true; node: HierarchyNode }>(response);
}

export async function deleteHierarchyNodeApi(nodeId: string) {
  const response = await fetch(`/api/hierarchy/nodes/${nodeId}`, { method: "DELETE" });
  return readJson<{ ok: true; deletedNodeId: string; counts: Record<string, number> }>(response);
}

export async function ensureHierarchyRootApi(family: HierarchyFamily) {
  const response = await fetch("/api/hierarchy/roots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ family })
  });
  return readJson<{ ok: true; node: HierarchyNode }>(response);
}

export async function archiveHierarchyNodeApi(nodeId: string, archived: boolean) {
  const response = await fetch(`/api/hierarchy/nodes/${nodeId}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived })
  });
  return readJson<{ ok: true; node: HierarchyNode }>(response);
}

export async function fetchHierarchyNodeDetailsApi(nodeId: string) {
  const response = await fetch(`/api/hierarchy/nodes/${nodeId}`, { cache: "no-store" });
  return readJson<HierarchyNodeDetails>(response);
}

export async function fetchAllowedHierarchyDestinationsApi(family: Exclude<HierarchyFamily, "media">) {
  const response = await fetch(`/api/hierarchy/destinations?family=${encodeURIComponent(family)}`, { cache: "no-store" });
  return readJson<{ nodes: HierarchyNode[] }>(response);
}

export async function createHierarchyDestinationApi(input: {
  family: Exclude<HierarchyFamily, "media">;
  parentId: string;
  nodeKind: Exclude<HierarchyNodeKind, "root">;
  nodeKey: string;
  name: string;
  sortOrder?: number;
  creationMode?: "record" | "hybrid";
  metadata?: Record<string, unknown>;
}) {
  const response = await fetch("/api/hierarchy/destinations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<{ ok: true; node: HierarchyNode }>(response);
}

export async function fetchFieldDefinitionsApi(family: HierarchyFamily, nodeId?: string) {
  const query = new URLSearchParams({ family });
  if (nodeId) query.set("nodeId", nodeId);
  const response = await fetch(`/api/hierarchy/fields?${query.toString()}`, { cache: "no-store" });
  return readJson<{ fields: EffectiveFieldDefinition[] }>(response);
}
