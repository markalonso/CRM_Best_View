import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseClient } from "@/services/supabase/client";
import type {
  CRMRecordFamily,
  EffectiveFieldDefinition,
  FieldDefinition,
  HierarchyFieldOverride,
  HierarchyNodeDetails,
  HierarchyNodeUsageCounts,
  HierarchyNode,
  HierarchyTreeNode,
  ReviewHierarchyType
} from "@/types/hierarchy";

const recordTableByFamily: Record<CRMRecordFamily, string> = {
  sale: "properties_sale",
  rent: "properties_rent",
  buyers: "buyers",
  clients: "clients"
};

const recordLinkColumnByFamily: Record<CRMRecordFamily, "sale_id" | "rent_id" | "buyer_id" | "client_id"> = {
  sale: "sale_id",
  rent: "rent_id",
  buyers: "buyer_id",
  clients: "client_id"
};

const customValueColumnByFamily: Record<HierarchyNode["family"], "sale_id" | "rent_id" | "buyer_id" | "client_id" | "media_id"> = {
  sale: "sale_id",
  rent: "rent_id",
  buyers: "buyer_id",
  clients: "client_id",
  media: "media_id"
};

export function reviewTypeToHierarchyFamily(type: ReviewHierarchyType): CRMRecordFamily {
  if (type === "sale") return "sale";
  if (type === "rent") return "rent";
  if (type === "buyer") return "buyers";
  return "clients";
}

function slugifyNodeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function normalizeNode(row: Record<string, unknown>): HierarchyNode {
  return {
    id: String(row.id),
    family: String(row.family) as HierarchyNode["family"],
    parent_id: row.parent_id ? String(row.parent_id) : null,
    node_kind: String(row.node_kind) as HierarchyNode["node_kind"],
    node_key: String(row.node_key || ""),
    name: String(row.name || ""),
    path_text: String(row.path_text || ""),
    depth: Number(row.depth || 0),
    sort_order: Number(row.sort_order || 0),
    allow_record_assignment: Boolean(row.allow_record_assignment),
    can_have_children: row.can_have_children === undefined ? true : Boolean(row.can_have_children),
    can_contain_records: row.can_contain_records === undefined ? Boolean(row.allow_record_assignment) : Boolean(row.can_contain_records),
    is_root: Boolean(row.is_root),
    is_active: Boolean(row.is_active),
    archived_at: row.archived_at ? String(row.archived_at) : null,
    metadata: (row.metadata || {}) as Record<string, unknown>,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  };
}

function rootNameByFamily(family: HierarchyNode["family"]) {
  if (family === "sale") return "Sale";
  if (family === "rent") return "Rent";
  if (family === "buyers") return "Buyers";
  if (family === "clients") return "Clients";
  return "Media";
}

function buildHierarchyNodeBehavior(input: {
  mutationMode?: "folder" | "record" | "hybrid";
  allowRecordAssignment?: boolean;
  canHaveChildren?: boolean;
  canContainRecords?: boolean;
}) {
  const canContainRecords = input.canContainRecords ?? input.allowRecordAssignment ?? (input.mutationMode === "record" || input.mutationMode === "hybrid");
  const canHaveChildren = input.canHaveChildren ?? (input.mutationMode === "record" ? false : true);

  if (!canHaveChildren && !canContainRecords) {
    throw new Error("Hierarchy nodes must allow children, records, or both");
  }

  return {
    canHaveChildren,
    canContainRecords,
    allowRecordAssignment: canContainRecords
  };
}

async function getNodeUsageCounts(nodeId: string): Promise<HierarchyNodeUsageCounts> {
  const supabase = createSupabaseAdminClient();
  const [
    childNodesResult,
    recordLinksResult,
    mediaLinksResult
  ] = await Promise.all([
    supabase.from("hierarchy_nodes").select("id", { count: "exact", head: true }).eq("parent_id", nodeId),
    supabase.from("record_hierarchy_links").select("id", { count: "exact", head: true }).eq("node_id", nodeId),
    supabase.from("media_hierarchy_links").select("id", { count: "exact", head: true }).eq("node_id", nodeId)
  ]);

  if (childNodesResult.error) throw new Error(childNodesResult.error.message);
  if (recordLinksResult.error) throw new Error(recordLinksResult.error.message);
  if (mediaLinksResult.error) throw new Error(mediaLinksResult.error.message);

  return {
    child_nodes: childNodesResult.count || 0,
    linked_records: recordLinksResult.count || 0,
    linked_media: mediaLinksResult.count || 0
  };
}

function normalizeFieldDefinition(row: Record<string, unknown>): FieldDefinition {
  return {
    id: String(row.id),
    family: String(row.family) as FieldDefinition["family"],
    field_key: String(row.field_key || ""),
    default_label: String(row.default_label || ""),
    description: row.description ? String(row.description) : null,
    data_type: String(row.data_type) as FieldDefinition["data_type"],
    storage_kind: String(row.storage_kind) as FieldDefinition["storage_kind"],
    core_column_name: row.core_column_name ? String(row.core_column_name) : null,
    is_system: Boolean(row.is_system),
    is_active: Boolean(row.is_active),
    is_visible_default: Boolean(row.is_visible_default),
    is_required_default: Boolean(row.is_required_default),
    is_filterable_default: Boolean(row.is_filterable_default),
    is_sortable_default: Boolean(row.is_sortable_default),
    is_grid_visible_default: Boolean(row.is_grid_visible_default),
    is_intake_visible_default: Boolean(row.is_intake_visible_default),
    is_detail_visible_default: Boolean(row.is_detail_visible_default),
    display_order_default: Number(row.display_order_default || 0),
    options_json: (row.options_json || {}) as Record<string, unknown>,
    validation_json: (row.validation_json || {}) as Record<string, unknown>,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  };
}

function normalizeOverride(row: Record<string, unknown>): HierarchyFieldOverride {
  return {
    id: String(row.id),
    node_id: String(row.node_id),
    field_definition_id: String(row.field_definition_id),
    override_label: row.override_label ? String(row.override_label) : null,
    is_visible: typeof row.is_visible === "boolean" ? row.is_visible : null,
    is_required: typeof row.is_required === "boolean" ? row.is_required : null,
    is_filterable: typeof row.is_filterable === "boolean" ? row.is_filterable : null,
    is_sortable: typeof row.is_sortable === "boolean" ? row.is_sortable : null,
    is_grid_visible: typeof row.is_grid_visible === "boolean" ? row.is_grid_visible : null,
    is_intake_visible: typeof row.is_intake_visible === "boolean" ? row.is_intake_visible : null,
    is_detail_visible: typeof row.is_detail_visible === "boolean" ? row.is_detail_visible : null,
    display_order: row.display_order === null || row.display_order === undefined ? null : Number(row.display_order),
    width_px: row.width_px === null || row.width_px === undefined ? null : Number(row.width_px),
    options_override_json: (row.options_override_json as Record<string, unknown> | null) ?? null,
    validation_override_json: (row.validation_override_json as Record<string, unknown> | null) ?? null,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  };
}

function buildTree(nodes: HierarchyNode[]): HierarchyTreeNode[] {
  const byId = new Map<string, HierarchyTreeNode>();
  const roots: HierarchyTreeNode[] = [];

  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] });
  }

  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: HierarchyTreeNode[]) => {
    items.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    items.forEach((child) => sortNodes(child.children));
  };

  sortNodes(roots);
  return roots;
}

async function getNodeOrThrow(nodeId: string, options?: { admin?: boolean }) {
  const supabase = options?.admin ? createSupabaseAdminClient() : createSupabaseClient();
  const { data, error } = await supabase.from("hierarchy_nodes").select("*").eq("id", nodeId).single();
  if (error || !data) throw new Error(error?.message || "Hierarchy node not found");
  return normalizeNode((data || {}) as Record<string, unknown>);
}

async function getDescendantNodeIds(nodeId: string, includeDescendants: boolean) {
  if (!includeDescendants) return [nodeId];
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("hierarchy_node_closure")
    .select("descendant_id")
    .eq("ancestor_id", nodeId);

  if (error) throw new Error(error.message);
  return (data || []).map((row) => String(row.descendant_id));
}

export async function fetchHierarchyTree(family: HierarchyNode["family"]) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("hierarchy_nodes")
    .select("*")
    .eq("family", family)
    .order("depth", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  const nodes = (data || []).map((row) => normalizeNode(row as Record<string, unknown>));
  return { nodes, tree: buildTree(nodes) };
}

export async function ensureHierarchyFamilyRoot(input: {
  family: HierarchyNode["family"];
  actorUserId?: string | null;
}) {
  const supabase = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await supabase
    .from("hierarchy_nodes")
    .select("*")
    .eq("family", input.family)
    .eq("is_root", true)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing) return normalizeNode(existing as Record<string, unknown>);

  const payload = {
    family: input.family,
    parent_id: null,
    node_kind: "root",
    node_key: input.family,
    name: rootNameByFamily(input.family),
    sort_order: 0,
    can_have_children: true,
    can_contain_records: false,
    allow_record_assignment: false,
    is_root: true,
    is_active: true,
    metadata: {},
    created_by: input.actorUserId || null
  };

  const { data, error } = await supabase.from("hierarchy_nodes").insert(payload).select("*").single();
  if (error || !data) throw new Error(error?.message || "Failed to create hierarchy root");
  return normalizeNode(data as Record<string, unknown>);
}

export async function fetchHierarchyNodeDetails(nodeId: string): Promise<HierarchyNodeDetails> {
  const supabase = createSupabaseClient();
  const node = await getNodeOrThrow(nodeId);
  const usage = await getNodeUsageCounts(nodeId);

  let parent: HierarchyNode | null = null;
  if (node.parent_id) {
    const { data: parentRow, error: parentError } = await supabase.from("hierarchy_nodes").select("*").eq("id", node.parent_id).maybeSingle();
    if (parentError) throw new Error(parentError.message);
    parent = parentRow ? normalizeNode(parentRow as Record<string, unknown>) : null;
  }

  return { node, parent, usage };
}

export async function fetchAllowedHierarchyDestinationNodes(family: CRMRecordFamily) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("hierarchy_nodes")
    .select("*")
    .eq("family", family)
    .eq("is_active", true)
    .eq("is_root", false)
    .eq("can_contain_records", true)
    .eq("allow_record_assignment", true)
    .order("depth", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []).map((row) => normalizeNode(row as Record<string, unknown>));
}

export async function assertValidRecordHierarchyDestination(input: { family: CRMRecordFamily; nodeId: string }) {
  const existingNode = await getNodeOrThrow(input.nodeId, { admin: true });
  if (existingNode.family !== input.family) {
    throw new Error(`Node family ${existingNode.family} does not match record family ${input.family}`);
  }
  if (existingNode.is_root) {
    throw new Error("Business records cannot be assigned directly to a family root node");
  }
  if (!existingNode.is_active) {
    throw new Error("Selected hierarchy destination is archived. Choose an active destination node.");
  }
  if (!existingNode.can_contain_records || !existingNode.allow_record_assignment) {
    throw new Error("Selected hierarchy destination is container-only. Choose an active record destination node.");
  }
  return existingNode;
}

export async function createHierarchyNode(input: {
  family: HierarchyNode["family"];
  parentId?: string | null;
  nodeKind: HierarchyNode["node_kind"];
  nodeKey: string;
  name: string;
  sortOrder?: number;
  allowRecordAssignment?: boolean;
  mutationMode?: "folder" | "record" | "hybrid";
  canHaveChildren?: boolean;
  canContainRecords?: boolean;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
  actorUserId?: string | null;
}) {
  if (!input.parentId) {
    throw new Error("Child node creation requires a parentId. Seed the family root first if it is missing.");
  }

  const supabase = createSupabaseAdminClient();
  const parent = await getNodeOrThrow(input.parentId, { admin: true });
  if (parent.family !== input.family) {
    throw new Error(`Parent family ${parent.family} does not match requested family ${input.family}`);
  }
  if (!parent.is_active) {
    throw new Error("Selected parent node is archived. Choose an active parent branch.");
  }
  if (!parent.can_have_children) {
    throw new Error("Selected parent node cannot contain child nodes");
  }

  if (input.nodeKind === "root") {
    throw new Error("Child nodes cannot use the root kind");
  }

  const behavior = buildHierarchyNodeBehavior({
    mutationMode: input.mutationMode,
    allowRecordAssignment: input.allowRecordAssignment,
    canHaveChildren: input.canHaveChildren,
    canContainRecords: input.canContainRecords
  });

  if (input.family === "media" && behavior.canContainRecords) {
    throw new Error("Media hierarchy nodes are navigation/media containers only and cannot receive business records");
  }

  const payload = {
    family: input.family,
    parent_id: input.parentId || null,
    node_kind: input.nodeKind,
    node_key: input.nodeKey,
    name: input.name,
    sort_order: input.sortOrder ?? 0,
    allow_record_assignment: behavior.allowRecordAssignment,
    can_have_children: behavior.canHaveChildren,
    can_contain_records: behavior.canContainRecords,
    is_active: input.isActive ?? true,
    metadata: input.metadata || {},
    created_by: input.actorUserId || null
  };

  const { data, error } = await supabase.from("hierarchy_nodes").insert(payload).select("*").single();
  if (error || !data) throw new Error(error?.message || "Failed to create hierarchy node");
  return normalizeNode((data || {}) as Record<string, unknown>);
}

export async function createOrReuseIntakeMediaChildNode(input: {
  family: CRMRecordFamily;
  parentNodeId: string;
  intakeSessionId: string;
  folderName: string;
  actorUserId?: string | null;
}) {
  const supabase = createSupabaseAdminClient();
  const parent = await getNodeOrThrow(input.parentNodeId, { admin: true });

  if (parent.family !== input.family) {
    throw new Error(`Parent family ${parent.family} does not match requested family ${input.family}`);
  }
  if (!parent.is_active) {
    throw new Error("Selected hierarchy destination is archived. Choose an active destination node.");
  }
  if (!parent.can_have_children) {
    throw new Error("Selected hierarchy destination cannot create child media folders. Choose a branch that allows child folders or ask an admin to enable children on this node.");
  }

  const trimmedName = input.folderName.trim();
  if (!trimmedName) {
    throw new Error("Media folder name is required when intake contains media.");
  }

  const nodeKeyBase = slugifyNodeKey(trimmedName) || "media";
  const deterministicSuffix = input.intakeSessionId.replace(/-/g, "").slice(0, 12);
  const nodeKey = `${nodeKeyBase}-${deterministicSuffix}`.slice(0, 100);
  const metadata = {
    created_from: "intake_media_folder",
    intake_session_id: input.intakeSessionId,
    media_folder_name: trimmedName
  };

  const { data: existingByKey, error: existingError } = await supabase
    .from("hierarchy_nodes")
    .select("*")
    .eq("family", input.family)
    .eq("parent_id", input.parentNodeId)
    .eq("node_key", nodeKey)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existingByKey) return normalizeNode(existingByKey as Record<string, unknown>);

  try {
    return await createHierarchyNode({
      family: input.family,
      parentId: input.parentNodeId,
      nodeKind: "folder",
      nodeKey,
      name: trimmedName,
      sortOrder: 0,
      allowRecordAssignment: false,
      mutationMode: "folder",
      canHaveChildren: true,
      canContainRecords: false,
      isActive: true,
      metadata,
      actorUserId: input.actorUserId || null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create media child folder";
    const normalized = message.toLowerCase();
    if (!normalized.includes("duplicate") && !normalized.includes("unique")) {
      throw error;
    }

    const { data: existingAfterConflict, error: retryError } = await supabase
      .from("hierarchy_nodes")
      .select("*")
      .eq("family", input.family)
      .eq("parent_id", input.parentNodeId)
      .eq("node_key", nodeKey)
      .single();

    if (retryError || !existingAfterConflict) {
      throw new Error(retryError?.message || message);
    }

    return normalizeNode(existingAfterConflict as Record<string, unknown>);
  }
}

export async function createHierarchyDestinationNode(input: {
  family: CRMRecordFamily;
  parentId: string;
  nodeKind: Exclude<HierarchyNode["node_kind"], "root">;
  nodeKey: string;
  name: string;
  sortOrder?: number;
  creationMode?: "record" | "hybrid";
  metadata?: Record<string, unknown>;
  actorUserId?: string | null;
}) {
  const creationMode = input.creationMode || "record";
  return createHierarchyNode({
    family: input.family,
    parentId: input.parentId,
    nodeKind: input.nodeKind,
    nodeKey: input.nodeKey,
    name: input.name,
    sortOrder: input.sortOrder,
    allowRecordAssignment: true,
    mutationMode: creationMode,
    canHaveChildren: creationMode === "hybrid",
    canContainRecords: true,
    isActive: true,
    metadata: input.metadata,
    actorUserId: input.actorUserId
  });
}

export async function updateHierarchyNode(nodeId: string, input: {
  nodeKind?: HierarchyNode["node_kind"];
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
  const supabase = createSupabaseAdminClient();
  const existingNode = await getNodeOrThrow(nodeId, { admin: true });
  const usage = await getNodeUsageCounts(nodeId);

  if (existingNode.is_root && (input.isActive === false || input.nodeKind || input.nodeKey || input.allowRecordAssignment !== undefined || input.canContainRecords !== undefined || input.canHaveChildren !== undefined || input.mutationMode)) {
    throw new Error("Root hierarchy nodes are navigation-only and cannot be archived or reconfigured");
  }
  if (input.isActive !== undefined && input.isActive !== existingNode.is_active) {
    throw new Error("Use the archive/restore action for hierarchy activation changes");
  }
  if (input.nodeKind === "root") {
    throw new Error("Child nodes cannot be converted into root nodes");
  }

  const updatePayload: Record<string, unknown> = {};
  if (input.nodeKind !== undefined) updatePayload.node_kind = input.nodeKind;
  if (input.nodeKey !== undefined) updatePayload.node_key = input.nodeKey;
  if (input.name !== undefined) updatePayload.name = input.name;
  if (input.sortOrder !== undefined) updatePayload.sort_order = input.sortOrder;
  if (input.metadata !== undefined) updatePayload.metadata = input.metadata;

  if (input.allowRecordAssignment !== undefined || input.mutationMode !== undefined || input.canHaveChildren !== undefined || input.canContainRecords !== undefined) {
    const behavior = buildHierarchyNodeBehavior({
      mutationMode: input.mutationMode,
      allowRecordAssignment: input.allowRecordAssignment ?? existingNode.allow_record_assignment,
      canHaveChildren: input.canHaveChildren,
      canContainRecords: input.canContainRecords
    });

    if (existingNode.family === "media" && behavior.canContainRecords) {
      throw new Error("Media hierarchy nodes are navigation/media containers only and cannot receive business records");
    }
    if (!behavior.canHaveChildren && usage.child_nodes > 0) {
      throw new Error("Cannot disable child folders while this node still has child nodes");
    }
    if (!behavior.canContainRecords && usage.linked_records > 0) {
      throw new Error("Cannot make this node folder-only while business records are still linked to it");
    }

    updatePayload.allow_record_assignment = behavior.allowRecordAssignment;
    updatePayload.can_have_children = behavior.canHaveChildren;
    updatePayload.can_contain_records = behavior.canContainRecords;
  }

  const { data, error } = await supabase.from("hierarchy_nodes").update(updatePayload).eq("id", nodeId).select("*").single();
  if (error || !data) throw new Error(error?.message || "Failed to update hierarchy node");
  return normalizeNode((data || {}) as Record<string, unknown>);
}

export async function archiveHierarchyNode(nodeId: string, archived: boolean) {
  const supabase = createSupabaseAdminClient();
  const node = await getNodeOrThrow(nodeId, { admin: true });
  if (node.is_root) {
    throw new Error("Root nodes cannot be archived");
  }

  if (archived) {
    const usage = await getNodeUsageCounts(nodeId);
    if (usage.child_nodes > 0 || usage.linked_records > 0 || usage.linked_media > 0) {
      throw new Error("Archive is only allowed for empty nodes. Remove child nodes, linked records, and linked media first.");
    }
  }

  const { data, error } = await supabase
    .from("hierarchy_nodes")
    .update({
      is_active: !archived,
      archived_at: archived ? new Date().toISOString() : null
    })
    .eq("id", nodeId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Failed to update archive state");
  return normalizeNode(data as Record<string, unknown>);
}

export async function deleteHierarchyNode(nodeId: string) {
  const supabase = createSupabaseAdminClient();
  const node = await getNodeOrThrow(nodeId, { admin: true });
  if (node.depth === 0 || node.node_kind === "root" || node.is_root) {
    throw new Error("Root nodes cannot be deleted");
  }

  const usage = await getNodeUsageCounts(nodeId);
  const isEmpty = Object.values(usage).every((value) => value === 0);
  if (!isEmpty) {
    throw new Error(`Node is not empty and cannot be deleted. Usage: ${JSON.stringify(usage)}`);
  }

  const { error } = await supabase.from("hierarchy_nodes").delete().eq("id", nodeId);
  if (error) throw new Error(error.message);
  return { deletedNodeId: nodeId, counts: usage };
}

export async function moveHierarchyNode(nodeId: string, newParentId: string | null) {
  const supabase = createSupabaseClient();
  const { error } = await supabase.rpc("move_hierarchy_node", {
    p_node_id: nodeId,
    p_new_parent_id: newParentId
  });

  if (error) {
    throw new Error(`${error.message}. Ensure the move_hierarchy_node database function exists before enabling node move in production.`);
  }

  return getNodeOrThrow(nodeId);
}

export async function fetchRecordsByNode(input: {
  nodeId: string;
  family: CRMRecordFamily;
  archiveScope?: "active" | "archived" | "all";
  includeDescendants?: boolean;
  limit?: number;
}) {
  const supabase = createSupabaseClient();
  const nodeIds = await getDescendantNodeIds(input.nodeId, input.includeDescendants ?? true);
  const recordColumn = recordLinkColumnByFamily[input.family];

  const { data: links, error: linkError } = await supabase
    .from("record_hierarchy_links")
    .select(`id,node_id,${recordColumn}`)
    .in("node_id", nodeIds)
    .not(recordColumn, "is", null)
    .limit(input.limit ?? 50);

  if (linkError) throw new Error(linkError.message);

  const linkRows = (links || []) as Array<Record<string, unknown>>;
  const recordIds = linkRows.map((row) => String(row[recordColumn] || "")).filter(Boolean);
  if (recordIds.length === 0) return [];

  let rowsQuery = supabase
    .from(recordTableByFamily[input.family])
    .select("*")
    .in("id", recordIds)
    .limit(input.limit ?? 50);

  const archiveScope = input.archiveScope ?? "active";
  if (archiveScope === "active") rowsQuery = rowsQuery.eq("is_archived", false);
  if (archiveScope === "archived") rowsQuery = rowsQuery.eq("is_archived", true);

  const { data: rows, error } = await rowsQuery;

  if (error) throw new Error(error.message);

  const nodeByRecordId = new Map<string, string>();
  linkRows.forEach((row) => {
    const recordId = String(row[recordColumn] || "");
    if (recordId) nodeByRecordId.set(recordId, String(row.node_id));
  });

  return ((rows || []) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    hierarchy_node_id: nodeByRecordId.get(String(row.id)) || null
  }));
}

export async function fetchMediaCountsByFamily(family: CRMRecordFamily) {
  const supabase = createSupabaseClient();
  const { data: nodeRows, error: nodeError } = await supabase
    .from("hierarchy_nodes")
    .select("id")
    .eq("family", family);

  if (nodeError) throw new Error(nodeError.message);

  const nodeIds = (nodeRows || []).map((row) => String(row.id || "")).filter(Boolean);
  if (nodeIds.length === 0) return {} as Record<string, { total: number; images: number; videos: number; documents: number }>;

  const { data: closureRows, error: closureError } = await supabase
    .from("hierarchy_node_closure")
    .select("ancestor_id,descendant_id")
    .in("ancestor_id", nodeIds)
    .in("descendant_id", nodeIds);

  if (closureError) throw new Error(closureError.message);

  const { data: mediaLinks, error: linkError } = await supabase
    .from("media_hierarchy_links")
    .select("node_id,media_id")
    .in("node_id", nodeIds);

  if (linkError) throw new Error(linkError.message);

  const mediaIds = (mediaLinks || []).map((row) => String(row.media_id || "")).filter(Boolean);
  if (mediaIds.length === 0) {
    return Object.fromEntries(nodeIds.map((id) => [id, { total: 0, images: 0, videos: 0, documents: 0 }])) as Record<string, { total: number; images: number; videos: number; documents: number }>;
  }

  const { data: mediaRows, error: mediaError } = await supabase
    .from("media")
    .select("id,media_type")
    .in("id", mediaIds);

  if (mediaError) throw new Error(mediaError.message);

  const typeByMediaId = new Map<string, string>((mediaRows || []).map((row) => [String(row.id), String(row.media_type || "other")]));
  const directCounts = new Map<string, { total: number; images: number; videos: number; documents: number }>();

  for (const link of mediaLinks || []) {
    const nodeId = String(link.node_id || "");
    const mediaType = typeByMediaId.get(String(link.media_id || "")) || "other";
    const current = directCounts.get(nodeId) || { total: 0, images: 0, videos: 0, documents: 0 };
    current.total += 1;
    if (mediaType === "image") current.images += 1;
    else if (mediaType === "video") current.videos += 1;
    else current.documents += 1;
    directCounts.set(nodeId, current);
  }

  const totals = new Map<string, { total: number; images: number; videos: number; documents: number }>();
  for (const nodeId of nodeIds) {
    totals.set(nodeId, { total: 0, images: 0, videos: 0, documents: 0 });
  }

  for (const row of closureRows || []) {
    const ancestorId = String(row.ancestor_id || "");
    const descendantId = String(row.descendant_id || "");
    const descendantTotals = directCounts.get(descendantId);
    if (!descendantTotals) continue;
    const current = totals.get(ancestorId) || { total: 0, images: 0, videos: 0, documents: 0 };
    current.total += descendantTotals.total;
    current.images += descendantTotals.images;
    current.videos += descendantTotals.videos;
    current.documents += descendantTotals.documents;
    totals.set(ancestorId, current);
  }

  return Object.fromEntries(totals.entries()) as Record<string, { total: number; images: number; videos: number; documents: number }>;
}

export async function fetchMediaByNode(input: { nodeId: string; includeDescendants?: boolean; limit?: number }) {
  const supabase = createSupabaseClient();
  const nodeIds = await getDescendantNodeIds(input.nodeId, input.includeDescendants ?? true);

  const { data: links, error: linkError } = await supabase
    .from("media_hierarchy_links")
    .select("media_id,node_id,is_primary")
    .in("node_id", nodeIds)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 100);

  if (linkError) throw new Error(linkError.message);

  const mediaIds = (links || []).map((row) => String(row.media_id || "")).filter(Boolean);
  if (mediaIds.length === 0) return [];

  const { data: mediaRows, error } = await supabase
    .from("media")
    .select("*")
    .in("id", mediaIds)
    .limit(input.limit ?? 100);

  if (error) throw new Error(error.message);

  const nodeByMediaId = new Map<string, string>();
  (links || []).forEach((row) => nodeByMediaId.set(String(row.media_id), String(row.node_id)));

  return ((mediaRows || []) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    hierarchy_node_id: nodeByMediaId.get(String(row.id)) || null
  }));
}

export async function fetchEffectiveFieldDefinitions(input: {
  family: HierarchyNode["family"];
  nodeId?: string;
}) {
  const supabase = createSupabaseClient();
  const { data: fieldRows, error: fieldError } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("family", input.family)
    .eq("is_active", true)
    .order("display_order_default", { ascending: true })
    .order("field_key", { ascending: true });

  if (fieldError) throw new Error(fieldError.message);

  const fields = (fieldRows || []).map((row) => normalizeFieldDefinition(row as Record<string, unknown>));
  if (!input.nodeId) {
    return fields.map<EffectiveFieldDefinition>((field) => ({
      ...field,
      effective_label: field.default_label,
      effective_visible: field.is_visible_default,
      effective_required: field.is_required_default,
      effective_filterable: field.is_filterable_default,
      effective_sortable: field.is_sortable_default,
      effective_grid_visible: field.is_grid_visible_default,
      effective_intake_visible: field.is_intake_visible_default,
      effective_detail_visible: field.is_detail_visible_default,
      effective_display_order: field.display_order_default,
      effective_width_px: null,
      effective_options_json: field.options_json,
      effective_validation_json: field.validation_json,
      override_source_node_id: null
    }));
  }

  const { data: ancestorRows, error: ancestorError } = await supabase
    .from("hierarchy_node_closure")
    .select("ancestor_id,depth")
    .eq("descendant_id", input.nodeId)
    .order("depth", { ascending: true });

  if (ancestorError) throw new Error(ancestorError.message);

  const ancestorIds = (ancestorRows || []).map((row) => String(row.ancestor_id));
  const depthByAncestor = new Map<string, number>((ancestorRows || []).map((row) => [String(row.ancestor_id), Number(row.depth || 0)]));

  if (ancestorIds.length === 0) return fields.map<EffectiveFieldDefinition>((field) => ({
    ...field,
    effective_label: field.default_label,
    effective_visible: field.is_visible_default,
    effective_required: field.is_required_default,
    effective_filterable: field.is_filterable_default,
    effective_sortable: field.is_sortable_default,
    effective_grid_visible: field.is_grid_visible_default,
    effective_intake_visible: field.is_intake_visible_default,
    effective_detail_visible: field.is_detail_visible_default,
    effective_display_order: field.display_order_default,
    effective_width_px: null,
    effective_options_json: field.options_json,
    effective_validation_json: field.validation_json,
    override_source_node_id: null
  }));

  const { data: overrideRows, error: overrideError } = await supabase
    .from("hierarchy_field_overrides")
    .select("*")
    .in("node_id", ancestorIds);

  if (overrideError) throw new Error(overrideError.message);

  const bestOverrideByField = new Map<string, HierarchyFieldOverride>();
  (overrideRows || [])
    .map((row) => normalizeOverride(row as Record<string, unknown>))
    .sort((a, b) => (depthByAncestor.get(a.node_id) ?? 99999) - (depthByAncestor.get(b.node_id) ?? 99999))
    .forEach((override) => {
      if (!bestOverrideByField.has(override.field_definition_id)) {
        bestOverrideByField.set(override.field_definition_id, override);
      }
    });

  return fields.map<EffectiveFieldDefinition>((field) => {
    const override = bestOverrideByField.get(field.id);
    return {
      ...field,
      effective_label: override?.override_label || field.default_label,
      effective_visible: override?.is_visible ?? field.is_visible_default,
      effective_required: override?.is_required ?? field.is_required_default,
      effective_filterable: override?.is_filterable ?? field.is_filterable_default,
      effective_sortable: override?.is_sortable ?? field.is_sortable_default,
      effective_grid_visible: override?.is_grid_visible ?? field.is_grid_visible_default,
      effective_intake_visible: override?.is_intake_visible ?? field.is_intake_visible_default,
      effective_detail_visible: override?.is_detail_visible ?? field.is_detail_visible_default,
      effective_display_order: override?.display_order ?? field.display_order_default,
      effective_width_px: override?.width_px ?? null,
      effective_options_json: override?.options_override_json || field.options_json,
      effective_validation_json: override?.validation_override_json || field.validation_json,
      override_source_node_id: override?.node_id || null
    };
  }).sort((a, b) => a.effective_display_order - b.effective_display_order || a.field_key.localeCompare(b.field_key));
}

export async function saveFieldDefinition(input: {
  id?: string;
  family: FieldDefinition["family"];
  fieldKey: string;
  defaultLabel: string;
  description?: string | null;
  dataType: FieldDefinition["data_type"];
  storageKind: FieldDefinition["storage_kind"];
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
  scopeMode?: "family" | "selected_node";
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
  actorUserId?: string | null;
}) {
  const supabase = createSupabaseAdminClient();
  const scopeMode = input.scopeMode || "family";
  let existingField: FieldDefinition | null = null;

  if (!input.id && input.storageKind === "core_column") {
    throw new Error("Creating new core-column fields from Hierarchy Manager is disabled. Create a custom value field instead.");
  }
  if (scopeMode === "selected_node" && input.storageKind !== "custom_value") {
    throw new Error("Selected-node fields must use custom value storage.");
  }
  if (scopeMode === "selected_node" && !input.override?.nodeId) {
    throw new Error("Selected-node fields require a target hierarchy node.");
  }

  const normalizedFieldKey = input.fieldKey.trim().toLowerCase();

  if (input.id) {
    const { data: existingRow, error: existingError } = await supabase
      .from("field_definitions")
      .select("*")
      .eq("id", input.id)
      .single();

    if (existingError || !existingRow) throw new Error(existingError?.message || "Field definition not found");
    existingField = normalizeFieldDefinition(existingRow as Record<string, unknown>);

    if (existingField.storage_kind !== input.storageKind) {
      throw new Error("Changing field storage kind is not supported. Create a new field instead.");
    }
    if (existingField.storage_kind === "core_column" && existingField.core_column_name !== (input.coreColumnName ?? null)) {
      throw new Error("Changing the backing core column is not supported.");
    }
  }

  let reusableFieldForSelectedNode: FieldDefinition | null = null;
  if (!input.id && scopeMode === "selected_node") {
    const { data: siblingRows, error: reusableError } = await supabase
      .from("field_definitions")
      .select("*")
      .eq("family", input.family);

    if (reusableError) throw new Error(reusableError.message);
    const reusableRow = (siblingRows || []).find((row) => String(row.field_key || "").toLowerCase() === normalizedFieldKey);
    if (reusableRow) {
      const reusable = normalizeFieldDefinition(reusableRow as Record<string, unknown>);
      if (reusable.storage_kind !== "custom_value") {
        throw new Error(`Field key "${input.fieldKey}" already exists as a core-column field. Use a different key for a selected-node custom field.`);
      }
      if (!reusable.is_active) {
        const { data: reactivatedRow, error: reactivateError } = await supabase
          .from("field_definitions")
          .update({
            is_active: true,
            is_visible_default: false,
            is_required_default: false,
            is_filterable_default: false,
            is_sortable_default: false,
            is_grid_visible_default: false,
            is_intake_visible_default: false,
            is_detail_visible_default: false
          })
          .eq("id", reusable.id)
          .select("*")
          .single();

        if (reactivateError || !reactivatedRow) {
          throw new Error(reactivateError?.message || "Failed to reactivate existing field definition");
        }
        reusableFieldForSelectedNode = normalizeFieldDefinition(reactivatedRow as Record<string, unknown>);
      } else {
        reusableFieldForSelectedNode = reusable;
      }
    }
  }

  const shouldCreateNodeScopedCustomField = !input.id && scopeMode === "selected_node" && !reusableFieldForSelectedNode;
  const definitionPayload = {
    family: input.family,
    field_key: input.fieldKey,
    default_label: input.defaultLabel,
    description: input.description ?? null,
    data_type: input.dataType,
    storage_kind: input.storageKind,
    core_column_name: input.coreColumnName ?? null,
    is_system: input.isSystem ?? false,
    is_active: input.isActive ?? true,
    is_visible_default: shouldCreateNodeScopedCustomField ? false : input.isVisibleDefault ?? true,
    is_required_default: shouldCreateNodeScopedCustomField ? false : input.isRequiredDefault ?? false,
    is_filterable_default: shouldCreateNodeScopedCustomField ? false : input.isFilterableDefault ?? true,
    is_sortable_default: shouldCreateNodeScopedCustomField ? false : input.isSortableDefault ?? true,
    is_grid_visible_default: shouldCreateNodeScopedCustomField ? false : input.isGridVisibleDefault ?? true,
    is_intake_visible_default: shouldCreateNodeScopedCustomField ? false : input.isIntakeVisibleDefault ?? true,
    is_detail_visible_default: shouldCreateNodeScopedCustomField ? false : input.isDetailVisibleDefault ?? true,
    display_order_default: input.displayOrderDefault ?? 100,
    options_json: input.optionsJson || {},
    validation_json: input.validationJson || {},
    created_by: input.actorUserId || null
  };

  let fieldRow: Record<string, unknown> | null = null;
  if (reusableFieldForSelectedNode) {
    fieldRow = reusableFieldForSelectedNode as unknown as Record<string, unknown>;
  } else if (input.id) {
    const { data, error } = await supabase.from("field_definitions").update(definitionPayload).eq("id", input.id).select("*").single();
    if (error || !data) throw new Error(error?.message || "Failed to update field definition");
    fieldRow = data as Record<string, unknown>;
  } else {
    const { data, error } = await supabase.from("field_definitions").insert(definitionPayload).select("*").single();
    if (error || !data) throw new Error(error?.message || "Failed to create field definition");
    fieldRow = data as Record<string, unknown>;
  }

  const field = normalizeFieldDefinition(fieldRow);
  let override: HierarchyFieldOverride | null = null;

  const effectiveOverrideInput = shouldCreateNodeScopedCustomField
    ? {
        nodeId: input.override?.nodeId || "",
        overrideLabel: input.override?.overrideLabel ?? null,
        isVisible: input.override?.isVisible ?? input.isVisibleDefault ?? true,
        isRequired: input.override?.isRequired ?? input.isRequiredDefault ?? false,
        isFilterable: input.override?.isFilterable ?? input.isFilterableDefault ?? true,
        isSortable: input.override?.isSortable ?? input.isSortableDefault ?? true,
        isGridVisible: input.override?.isGridVisible ?? input.isGridVisibleDefault ?? true,
        isIntakeVisible: input.override?.isIntakeVisible ?? input.isIntakeVisibleDefault ?? true,
        isDetailVisible: input.override?.isDetailVisible ?? input.isDetailVisibleDefault ?? true,
        displayOrder: input.override?.displayOrder ?? input.displayOrderDefault ?? 100,
        widthPx: input.override?.widthPx ?? null,
        optionsOverrideJson: input.override?.optionsOverrideJson ?? null,
        validationOverrideJson: input.override?.validationOverrideJson ?? null
      }
    : input.override;

  if (effectiveOverrideInput) {
    const overrideNode = await getNodeOrThrow(effectiveOverrideInput.nodeId, { admin: true });
    if (overrideNode.family !== field.family) {
      throw new Error(`Override node family ${overrideNode.family} does not match field family ${field.family}`);
    }

    const existing = await supabase
      .from("hierarchy_field_overrides")
      .select("id")
      .eq("node_id", effectiveOverrideInput.nodeId)
      .eq("field_definition_id", field.id)
      .maybeSingle();

    const overridePayload = {
      node_id: effectiveOverrideInput.nodeId,
      field_definition_id: field.id,
      override_label: effectiveOverrideInput.overrideLabel ?? null,
      is_visible: effectiveOverrideInput.isVisible ?? null,
      is_required: effectiveOverrideInput.isRequired ?? null,
      is_filterable: effectiveOverrideInput.isFilterable ?? null,
      is_sortable: effectiveOverrideInput.isSortable ?? null,
      is_grid_visible: effectiveOverrideInput.isGridVisible ?? null,
      is_intake_visible: effectiveOverrideInput.isIntakeVisible ?? null,
      is_detail_visible: effectiveOverrideInput.isDetailVisible ?? null,
      display_order: effectiveOverrideInput.displayOrder ?? null,
      width_px: effectiveOverrideInput.widthPx ?? null,
      options_override_json: effectiveOverrideInput.optionsOverrideJson ?? null,
      validation_override_json: effectiveOverrideInput.validationOverrideJson ?? null,
      created_by: input.actorUserId || null
    };

    const query = existing.data?.id
      ? supabase.from("hierarchy_field_overrides").update(overridePayload).eq("id", String(existing.data.id)).select("*").single()
      : supabase.from("hierarchy_field_overrides").insert(overridePayload).select("*").single();

    const { data: overrideData, error: overrideError } = await query;
    if (overrideError || !overrideData) throw new Error(overrideError?.message || "Failed to save field override");
    override = normalizeOverride(overrideData as Record<string, unknown>);
  }

  return { field, override };
}


export async function deleteFieldDefinition(input: {
  fieldId: string;
  nodeId?: string;
}) {
  const supabase = createSupabaseAdminClient();

  const { data: fieldRow, error: fieldError } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("id", input.fieldId)
    .maybeSingle();

  if (fieldError) throw new Error(fieldError.message);
  if (!fieldRow) throw new Error("Field definition not found");

  const field = normalizeFieldDefinition(fieldRow as Record<string, unknown>);

  if (input.nodeId) {
    const { data: overrideRow, error: overrideLookupError } = await supabase
      .from("hierarchy_field_overrides")
      .select("id")
      .eq("field_definition_id", input.fieldId)
      .eq("node_id", input.nodeId)
      .maybeSingle();

    if (overrideLookupError) throw new Error(overrideLookupError.message);
    if (!overrideRow) throw new Error("No override exists for the selected node");

    const { error: deleteOverrideError } = await supabase
      .from("hierarchy_field_overrides")
      .delete()
      .eq("id", String(overrideRow.id));

    if (deleteOverrideError) throw new Error(deleteOverrideError.message);

    return { action: "override_deleted" as const, field };
  }

  const deletionPolicy = getFieldDeletionPolicy(field);
  if (!deletionPolicy.hard_delete_allowed) {
    throw new Error(`${deletionPolicy.protection_reason} ${deletionPolicy.recommended_action}`.trim());
  }

  const [overrideCountResult, valueCountResult] = await Promise.all([
    supabase
      .from("hierarchy_field_overrides")
      .select("id", { count: "exact", head: true })
      .eq("field_definition_id", input.fieldId),
    supabase
      .from("record_custom_field_values")
      .select("id", { count: "exact", head: true })
      .eq("field_definition_id", input.fieldId)
  ]);

  if (overrideCountResult.error) throw new Error(overrideCountResult.error.message);
  if (valueCountResult.error) throw new Error(valueCountResult.error.message);

  const impact = {
    override_count: overrideCountResult.count || 0,
    custom_value_count: valueCountResult.count || 0
  };

  const { error: deleteError } = await supabase
    .from("field_definitions")
    .delete()
    .eq("id", input.fieldId);

  if (deleteError) throw new Error(deleteError.message);

  return { action: "definition_deleted" as const, field, impact };
}

function getFieldDeletionPolicy(field: FieldDefinition) {
  if (field.is_system && field.storage_kind === "core_column") {
    return {
      hard_delete_allowed: false,
      protection_reason: "This field is protected because it is both system-managed and backed by a core database column.",
      recommended_action: "Keep the definition, and use visibility or node overrides if you need to hide it."
    };
  }

  if (field.is_system) {
    return {
      hard_delete_allowed: false,
      protection_reason: "This field is protected because system fields may be referenced by core CRM workflows and automations.",
      recommended_action: "Keep the definition, and use visibility or node overrides if you need to remove it from the UI."
    };
  }

  if (field.storage_kind === "core_column") {
    return {
      hard_delete_allowed: false,
      protection_reason: "This field is protected because deleting the definition would orphan live data still stored in a core record column.",
      recommended_action: "Keep the definition, or convert the field to hidden/inactive behavior through configuration instead of deleting it."
    };
  }

  return {
    hard_delete_allowed: true,
    protection_reason: null,
    recommended_action: "Hard delete is allowed for custom, non-system field definitions and will also remove their stored custom values and node overrides."
  };
}

export async function fetchFieldDeletionImpact(fieldId: string) {
  const supabase = createSupabaseAdminClient();
  const { data: fieldRow, error: fieldError } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("id", fieldId)
    .maybeSingle();

  if (fieldError) throw new Error(fieldError.message);
  if (!fieldRow) throw new Error("Field definition not found");

  const field = normalizeFieldDefinition(fieldRow as Record<string, unknown>);
  const [overrideCountResult, valueCountResult] = await Promise.all([
    supabase
      .from("hierarchy_field_overrides")
      .select("id", { count: "exact", head: true })
      .eq("field_definition_id", fieldId),
    supabase
      .from("record_custom_field_values")
      .select("id", { count: "exact", head: true })
      .eq("field_definition_id", fieldId)
  ]);

  if (overrideCountResult.error) throw new Error(overrideCountResult.error.message);
  if (valueCountResult.error) throw new Error(valueCountResult.error.message);
  const deletionPolicy = getFieldDeletionPolicy(field);

  return {
    field,
    impact: {
      override_count: overrideCountResult.count || 0,
      custom_value_count: valueCountResult.count || 0,
      hard_delete_allowed: deletionPolicy.hard_delete_allowed,
      protection_reason: deletionPolicy.protection_reason,
      recommended_action: deletionPolicy.recommended_action
    }
  };
}

export async function assignRecordToHierarchyNode(input: {
  family: CRMRecordFamily;
  recordId: string;
  nodeId: string;
  actorUserId?: string | null;
}) {
  const supabase = createSupabaseAdminClient();
  await assertValidRecordHierarchyDestination({ family: input.family, nodeId: input.nodeId });

  const linkColumn = recordLinkColumnByFamily[input.family];
  const { data: existingLink, error: existingError } = await supabase
    .from("record_hierarchy_links")
    .select("id,node_id")
    .eq(linkColumn, input.recordId)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  const payload = {
    node_id: input.nodeId,
    [linkColumn]: input.recordId,
    created_by: input.actorUserId || null
  } as Record<string, unknown>;

  const { data, error } = existingLink?.id
    ? await supabase.from("record_hierarchy_links").update({ node_id: input.nodeId }).eq("id", String(existingLink.id)).select("*").single()
    : await supabase.from("record_hierarchy_links").insert(payload).select("*").single();

  if (error || !data) throw new Error(error?.message || "Failed to assign record to hierarchy node");
  return data as Record<string, unknown>;
}

export async function assignMediaToHierarchyNode(input: { mediaId: string; nodeId: string; actorUserId?: string | null }) {
  const supabase = createSupabaseAdminClient();
  const existingNode = await getNodeOrThrow(input.nodeId, { admin: true });
  if (!existingNode.is_active) {
    throw new Error("Cannot assign media to an archived hierarchy node");
  }

  const { data: existingLink, error: existingError } = await supabase
    .from("media_hierarchy_links")
    .select("id")
    .eq("media_id", input.mediaId)
    .eq("is_primary", true)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  const payload = {
    media_id: input.mediaId,
    node_id: input.nodeId,
    is_primary: true,
    created_by: input.actorUserId || null
  };

  const { data, error } = existingLink?.id
    ? await supabase.from("media_hierarchy_links").update({ node_id: input.nodeId }).eq("id", String(existingLink.id)).select("*").single()
    : await supabase.from("media_hierarchy_links").insert(payload).select("*").single();

  if (error || !data) throw new Error(error?.message || "Failed to assign media to hierarchy node");
  return data as Record<string, unknown>;
}

function detectValueColumns(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return { value_number: value };
  if (typeof value === "boolean") return { value_boolean: value };
  if (typeof value === "string") return { value_text: value };
  return { value_json: value as Record<string, unknown> | unknown[] };
}

function decodeCustomFieldValue(row: Record<string, unknown>) {
  if (row.value_number !== null && row.value_number !== undefined) return Number(row.value_number);
  if (row.value_boolean !== null && row.value_boolean !== undefined) return Boolean(row.value_boolean);
  if (row.value_timestamp) return String(row.value_timestamp);
  if (row.value_date) return String(row.value_date);
  if (row.value_json !== null && row.value_json !== undefined) return row.value_json as Record<string, unknown> | unknown[];
  if (row.value_text !== null && row.value_text !== undefined) return String(row.value_text);
  return null;
}

export async function fetchCustomFieldValuesForRecords(input: {
  family: CRMRecordFamily;
  recordIds: string[];
  fieldDefinitionIds?: string[];
}) {
  if (input.recordIds.length === 0) return {} as Record<string, Record<string, unknown>>;

  const supabase = createSupabaseClient();
  const recordColumn = customValueColumnByFamily[input.family];
  let query = supabase
    .from("record_custom_field_values")
    .select(`field_definition_id,${recordColumn},value_text,value_number,value_boolean,value_date,value_timestamp,value_json`)
    .in(recordColumn, input.recordIds);

  if (input.fieldDefinitionIds?.length) {
    query = query.in("field_definition_id", input.fieldDefinitionIds);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const valuesByRecordId = new Map<string, Record<string, unknown>>();
  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const recordId = String(row[recordColumn] || "");
    if (!recordId) continue;
    const current = valuesByRecordId.get(recordId) || {};
    current[String(row.field_definition_id || "")] = decodeCustomFieldValue(row);
    valuesByRecordId.set(recordId, current);
  }

  return Object.fromEntries(valuesByRecordId.entries()) as Record<string, Record<string, unknown>>;
}

export async function saveCustomFieldValuesForRecord(input: {
  family: FieldDefinition["family"];
  recordId: string;
  values: Array<{ fieldKey: string; value: unknown }>;
  actorUserId?: string | null;
}) {
  const supabase = createSupabaseAdminClient();
  if (input.values.length === 0) return [];

  const { data: defs, error: defsError } = await supabase
    .from("field_definitions")
    .select("id,field_key,storage_kind")
    .eq("family", input.family)
    .in("field_key", input.values.map((item) => item.fieldKey));

  if (defsError) throw new Error(defsError.message);

  const customDefs = new Map(
    (defs || [])
      .filter((row) => String(row.storage_kind) === "custom_value")
      .map((row) => [String(row.field_key), String(row.id)])
  );

  const targetColumn = customValueColumnByFamily[input.family];

  const saved: Array<Record<string, unknown>> = [];

  for (const item of input.values) {
    const fieldDefinitionId = customDefs.get(item.fieldKey);
    if (!fieldDefinitionId) continue;

    const existing = await supabase
      .from("record_custom_field_values")
      .select("id")
      .eq("field_definition_id", fieldDefinitionId)
      .eq(targetColumn, input.recordId)
      .maybeSingle();

    const valuePayload = detectValueColumns(item.value);
    if (!valuePayload) {
      if (existing.data?.id) {
        const { error: deleteError } = await supabase
          .from("record_custom_field_values")
          .delete()
          .eq("id", String(existing.data.id));
        if (deleteError) throw new Error(deleteError.message);
      }
      continue;
    }

    const basePayload: Record<string, unknown> = {
      field_definition_id: fieldDefinitionId,
      created_by: input.actorUserId || null,
      sale_id: null,
      rent_id: null,
      buyer_id: null,
      client_id: null,
      media_id: null,
      value_text: null,
      value_number: null,
      value_boolean: null,
      value_date: null,
      value_timestamp: null,
      value_json: null,
      ...valuePayload,
      [targetColumn]: input.recordId
    };

    const query = existing.data?.id
      ? supabase.from("record_custom_field_values").update(basePayload).eq("id", String(existing.data.id)).select("*").single()
      : supabase.from("record_custom_field_values").insert(basePayload).select("*").single();

    const { data, error } = await query;
    if (error || !data) throw new Error(error?.message || `Failed to save custom field value for ${item.fieldKey}`);
    saved.push(data as Record<string, unknown>);
  }

  return saved;
}
