import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type GridType = "sale" | "rent" | "buyer" | "client";
type RecordTable = "properties_sale" | "properties_rent" | "buyers" | "clients";
type HierarchyFamily = "sale" | "rent" | "buyers" | "clients";
type ArchiveScope = "archived" | "active" | "all";

type ArchiveMutationResult = {
  updatedRecordIds: string[];
  archiveState: "archived" | "active";
};

const tableByType: Record<GridType, RecordTable> = {
  sale: "properties_sale",
  rent: "properties_rent",
  buyer: "buyers",
  client: "clients"
};

const hierarchyFamilyByType: Record<GridType, HierarchyFamily> = {
  sale: "sale",
  rent: "rent",
  buyer: "buyers",
  client: "clients"
};

const recordLinkColumnByType: Record<GridType, "sale_id" | "rent_id" | "buyer_id" | "client_id"> = {
  sale: "sale_id",
  rent: "rent_id",
  buyer: "buyer_id",
  client: "client_id"
};

async function resolveHierarchyRecordIds(type: GridType, nodeId: string) {
  const supabase = createSupabaseAdminClient();
  const family = hierarchyFamilyByType[type];
  const linkColumn = recordLinkColumnByType[type];

  const { data: node, error: nodeError } = await supabase
    .from("hierarchy_nodes")
    .select("id,family")
    .eq("id", nodeId)
    .single();

  if (nodeError || !node) {
    throw new Error(nodeError?.message || "Hierarchy node not found");
  }
  if (String(node.family) !== family) {
    throw new Error(`Hierarchy node family ${String(node.family)} does not match record type ${type}`);
  }

  const { data: closureRows, error: closureError } = await supabase
    .from("hierarchy_node_closure")
    .select("descendant_id")
    .eq("ancestor_id", nodeId);

  if (closureError) throw new Error(closureError.message);

  const descendantIds = (closureRows || []).map((row) => String(row.descendant_id || "")).filter(Boolean);
  if (descendantIds.length === 0) return [];

  const { data: linkRows, error: linkError } = await supabase
    .from("record_hierarchy_links")
    .select(linkColumn)
    .in("node_id", descendantIds)
    .not(linkColumn, "is", null);

  if (linkError) throw new Error(linkError.message);

  return (linkRows || []).map((row) => String((row as Record<string, unknown>)[linkColumn] || "")).filter(Boolean);
}

export async function setRecordsArchiveState(input: {
  type: GridType;
  recordIds: string[];
  archived: boolean;
  actorUserId: string;
}): Promise<ArchiveMutationResult> {
  if (input.recordIds.length === 0) throw new Error("Select at least one record.");

  const supabase = createSupabaseAdminClient();
  const table = tableByType[input.type];
  const nextState = input.archived ? "archived" : "active";

  const { data: existing, error: existingError } = await supabase
    .from(table)
    .select("id,is_archived")
    .in("id", input.recordIds);

  if (existingError) throw new Error(existingError.message);

  const existingIds = (existing || []).map((row) => String(row.id || "")).filter(Boolean);
  if (existingIds.length === 0) throw new Error("No matching records were found.");

  const transitionIds = (existing || [])
    .filter((row) => Boolean(row.is_archived) !== input.archived)
    .map((row) => String(row.id || ""))
    .filter(Boolean);

  if (transitionIds.length === 0) {
    return {
      updatedRecordIds: [],
      archiveState: nextState
    };
  }

  const payload = {
    is_archived: input.archived,
    archived_at: input.archived ? new Date().toISOString() : null,
    archived_by: input.archived ? input.actorUserId : null
  };

  const { data: updatedRows, error: updateError } = await supabase
    .from(table)
    .update(payload)
    .in("id", transitionIds)
    .select("id");

  if (updateError) throw new Error(updateError.message);

  return {
    updatedRecordIds: (updatedRows || []).map((row) => String(row.id || "")).filter(Boolean),
    archiveState: nextState
  };
}

export async function fetchArchivedRecords(input: {
  type: GridType;
  nodeId?: string;
  page?: number;
  pageSize?: number;
  archiveScope?: ArchiveScope;
}) {
  const supabase = createSupabaseAdminClient();
  const table = tableByType[input.type];
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.min(3000, Math.max(10, Number(input.pageSize || 20)));
  const archiveScope = input.archiveScope || "archived";

  let query = supabase.from(table).select("*", { count: "exact" });
  if (archiveScope === "archived") query = query.eq("is_archived", true);
  if (archiveScope === "active") query = query.eq("is_archived", false);

  if (input.nodeId) {
    const recordIds = await resolveHierarchyRecordIds(input.type, input.nodeId);
    if (recordIds.length === 0) return { rows: [], total: 0, page, pageSize };
    query = query.in("id", recordIds);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await query
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);

  return {
    rows: ((data || []) as Array<Record<string, unknown>>),
    total: count || 0,
    page,
    pageSize
  };
}
