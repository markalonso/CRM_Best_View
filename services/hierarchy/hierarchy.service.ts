import "server-only";
import { createSupabaseClient } from "@/services/supabase/client";
import type {
  CRMRecordFamily,
  EffectiveFieldDefinition,
  FieldDefinition,
  HierarchyFieldOverride,
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

export function reviewTypeToHierarchyFamily(type: ReviewHierarchyType): CRMRecordFamily {
  if (type === "sale") return "sale";
  if (type === "rent") return "rent";
  if (type === "buyer") return "buyers";
  return "clients";
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
    is_active: Boolean(row.is_active),
    metadata: (row.metadata || {}) as Record<string, unknown>,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
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

async function getNodeOrThrow(nodeId: string) {
  const supabase = createSupabaseClient();
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

export async function createHierarchyNode(input: {
  family: HierarchyNode["family"];
  parentId?: string | null;
  nodeKind: HierarchyNode["node_kind"];
  nodeKey: string;
  name: string;
  sortOrder?: number;
  allowRecordAssignment?: boolean;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
  actorUserId?: string | null;
}) {
  const supabase = createSupabaseClient();
  const payload = {
    family: input.family,
    parent_id: input.parentId || null,
    node_kind: input.nodeKind,
    node_key: input.nodeKey,
    name: input.name,
    sort_order: input.sortOrder ?? 0,
    allow_record_assignment: input.allowRecordAssignment ?? true,
    is_active: input.isActive ?? true,
    metadata: input.metadata || {},
    created_by: input.actorUserId || null
  };

  const { data, error } = await supabase.from("hierarchy_nodes").insert(payload).select("*").single();
  if (error || !data) throw new Error(error?.message || "Failed to create hierarchy node");
  return normalizeNode((data || {}) as Record<string, unknown>);
}

export async function updateHierarchyNode(nodeId: string, input: {
  nodeKind?: HierarchyNode["node_kind"];
  nodeKey?: string;
  name?: string;
  sortOrder?: number;
  allowRecordAssignment?: boolean;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createSupabaseClient();
  const updatePayload: Record<string, unknown> = {};
  if (input.nodeKind !== undefined) updatePayload.node_kind = input.nodeKind;
  if (input.nodeKey !== undefined) updatePayload.node_key = input.nodeKey;
  if (input.name !== undefined) updatePayload.name = input.name;
  if (input.sortOrder !== undefined) updatePayload.sort_order = input.sortOrder;
  if (input.allowRecordAssignment !== undefined) updatePayload.allow_record_assignment = input.allowRecordAssignment;
  if (input.isActive !== undefined) updatePayload.is_active = input.isActive;
  if (input.metadata !== undefined) updatePayload.metadata = input.metadata;

  const { data, error } = await supabase.from("hierarchy_nodes").update(updatePayload).eq("id", nodeId).select("*").single();
  if (error || !data) throw new Error(error?.message || "Failed to update hierarchy node");
  return normalizeNode((data || {}) as Record<string, unknown>);
}

export async function deleteHierarchyNode(nodeId: string) {
  const supabase = createSupabaseClient();
  const node = await getNodeOrThrow(nodeId);
  if (node.depth === 0 || node.node_kind === "root") {
    throw new Error("Root nodes cannot be deleted");
  }

  const [
    childNodesResult,
    saleLinksResult,
    rentLinksResult,
    buyerLinksResult,
    clientLinksResult,
    mediaLinksResult
  ] = await Promise.all([
    supabase.from("hierarchy_nodes").select("id", { count: "exact", head: true }).eq("parent_id", nodeId),
    supabase.from("record_hierarchy_links").select("id", { count: "exact", head: true }).eq("node_id", nodeId).not("sale_id", "is", null),
    supabase.from("record_hierarchy_links").select("id", { count: "exact", head: true }).eq("node_id", nodeId).not("rent_id", "is", null),
    supabase.from("record_hierarchy_links").select("id", { count: "exact", head: true }).eq("node_id", nodeId).not("buyer_id", "is", null),
    supabase.from("record_hierarchy_links").select("id", { count: "exact", head: true }).eq("node_id", nodeId).not("client_id", "is", null),
    supabase.from("media_hierarchy_links").select("id", { count: "exact", head: true }).eq("node_id", nodeId)
  ]);

  const counts = {
    childNodes: childNodesResult.count || 0,
    saleRecords: saleLinksResult.count || 0,
    rentRecords: rentLinksResult.count || 0,
    buyerRecords: buyerLinksResult.count || 0,
    clientRecords: clientLinksResult.count || 0,
    mediaItems: mediaLinksResult.count || 0
  };

  const isEmpty = Object.values(counts).every((value) => value === 0);
  if (!isEmpty) {
    throw new Error(`Node is not empty and cannot be deleted. Usage: ${JSON.stringify(counts)}`);
  }

  const { error } = await supabase.from("hierarchy_nodes").delete().eq("id", nodeId);
  if (error) throw new Error(error.message);
  return { deletedNodeId: nodeId, counts };
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

  const { data: rows, error } = await supabase
    .from(recordTableByFamily[input.family])
    .select("*")
    .in("id", recordIds)
    .limit(input.limit ?? 50);

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
  const supabase = createSupabaseClient();
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
    is_visible_default: input.isVisibleDefault ?? true,
    is_required_default: input.isRequiredDefault ?? false,
    is_filterable_default: input.isFilterableDefault ?? true,
    is_sortable_default: input.isSortableDefault ?? true,
    is_grid_visible_default: input.isGridVisibleDefault ?? true,
    is_intake_visible_default: input.isIntakeVisibleDefault ?? true,
    is_detail_visible_default: input.isDetailVisibleDefault ?? true,
    display_order_default: input.displayOrderDefault ?? 100,
    options_json: input.optionsJson || {},
    validation_json: input.validationJson || {},
    created_by: input.actorUserId || null
  };

  let fieldRow: Record<string, unknown> | null = null;
  if (input.id) {
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

  if (input.override) {
    const existing = await supabase
      .from("hierarchy_field_overrides")
      .select("id")
      .eq("node_id", input.override.nodeId)
      .eq("field_definition_id", field.id)
      .maybeSingle();

    const overridePayload = {
      node_id: input.override.nodeId,
      field_definition_id: field.id,
      override_label: input.override.overrideLabel ?? null,
      is_visible: input.override.isVisible ?? null,
      is_required: input.override.isRequired ?? null,
      is_filterable: input.override.isFilterable ?? null,
      is_sortable: input.override.isSortable ?? null,
      is_grid_visible: input.override.isGridVisible ?? null,
      is_intake_visible: input.override.isIntakeVisible ?? null,
      is_detail_visible: input.override.isDetailVisible ?? null,
      display_order: input.override.displayOrder ?? null,
      width_px: input.override.widthPx ?? null,
      options_override_json: input.override.optionsOverrideJson ?? null,
      validation_override_json: input.override.validationOverrideJson ?? null,
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

export async function assignRecordToHierarchyNode(input: {
  family: CRMRecordFamily;
  recordId: string;
  nodeId: string;
  actorUserId?: string | null;
}) {
  const supabase = createSupabaseClient();
  const existingNode = await getNodeOrThrow(input.nodeId);
  if (existingNode.family !== input.family) {
    throw new Error(`Node family ${existingNode.family} does not match record family ${input.family}`);
  }
  if (!existingNode.is_active) {
    throw new Error("Cannot assign records to an archived hierarchy node");
  }
  if (!existingNode.allow_record_assignment) {
    throw new Error("Selected hierarchy node is a container only and cannot receive records");
  }

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
  const supabase = createSupabaseClient();
  const existingNode = await getNodeOrThrow(input.nodeId);
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

export async function saveCustomFieldValuesForRecord(input: {
  family: FieldDefinition["family"];
  recordId: string;
  values: Array<{ fieldKey: string; value: unknown }>;
  actorUserId?: string | null;
}) {
  const supabase = createSupabaseClient();
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

  const targetColumn = input.family === "sale"
    ? "sale_id"
    : input.family === "rent"
      ? "rent_id"
      : input.family === "buyers"
        ? "buyer_id"
        : input.family === "clients"
          ? "client_id"
          : "media_id";

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
