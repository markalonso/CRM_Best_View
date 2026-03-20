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


export async function saveFieldDefinitionApi(input: {
  id?: string;
  family: HierarchyFamily;
  fieldKey: string;
  defaultLabel: string;
  description?: string | null;
  dataType: "text" | "long_text" | "integer" | "number" | "boolean" | "date" | "timestamp" | "single_select" | "multi_select" | "json";
  storageKind: "core_column" | "custom_value";
  coreColumnName?: string | null;
  isSystem?: boolean;
  isActive?: boolean;
  isVisibleDefault?: boolean;
  isRequiredDefault?: boolean;
  isFilterableDefault?: boolean;
  isSortableDefault?: boolean;
  isGridVisibleDefault?: boolean;
  isIntakeVisibleDefault?: boolean;
  isDetailVisibleDefault?: boolean;
  displayOrderDefault?: number;
  optionsJson?: Record<string, unknown>;
  validationJson?: Record<string, unknown>;
  override?: {
    nodeId: string;
    overrideLabel?: string | null;
    isVisible?: boolean | null;
    isRequired?: boolean | null;
    isFilterable?: boolean | null;
    isSortable?: boolean | null;
    isGridVisible?: boolean | null;
    isIntakeVisible?: boolean | null;
    isDetailVisible?: boolean | null;
    displayOrder?: number | null;
    widthPx?: number | null;
    optionsOverrideJson?: Record<string, unknown> | null;
    validationOverrideJson?: Record<string, unknown> | null;
  };
}) {
  const response = await fetch("/api/hierarchy/fields", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<{ ok: true; field: EffectiveFieldDefinition; override: unknown }>(response);
}

export async function deleteHierarchyFieldApi(fieldId: string, options?: { nodeId?: string }) {
  const query = new URLSearchParams();
  if (options?.nodeId) query.set("nodeId", options.nodeId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`/api/hierarchy/fields/${fieldId}${suffix}`, { method: "DELETE" });
  return readJson<{ ok: true; fieldId: string; action: "override_deleted" | "definition_deleted"; impact?: { override_count: number; custom_value_count: number } | null }>(response);
}

export async function fetchHierarchyFieldDeleteImpactApi(fieldId: string) {
  const response = await fetch(`/api/hierarchy/fields/${fieldId}`, { cache: "no-store" });
  return readJson<{
    field: EffectiveFieldDefinition;
    impact: {
      override_count: number;
      custom_value_count: number;
      hard_delete_allowed: boolean;
    };
  }>(response);
}

export async function deleteMediaItemApi(mediaId: string) {
  const response = await fetch(`/api/media/${mediaId}`, { method: "DELETE" });
  return readJson<{
    ok: true;
    media: {
      id: string;
      original_filename: string;
      record_type: string | null;
      record_id: string | null;
      intake_session_id: string | null;
    };
    storageWarnings: string[];
  }>(response);
}

export async function fetchFieldDefinitionsApi(family: HierarchyFamily, nodeId?: string) {
  const query = new URLSearchParams({ family });
  if (nodeId) query.set("nodeId", nodeId);
  const response = await fetch(`/api/hierarchy/fields?${query.toString()}`, { cache: "no-store" });
  return readJson<{ fields: EffectiveFieldDefinition[] }>(response);
}
