import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  deleteStorageObjectsForMediaSnapshots,
  fetchMediaDeleteSnapshotsForRecordSet
} from "@/services/media/media-delete.service";

type GridType = "sale" | "rent" | "buyer" | "client";
type RecordTable = "properties_sale" | "properties_rent" | "buyers" | "clients";

const tableByType: Record<GridType, RecordTable> = {
  sale: "properties_sale",
  rent: "properties_rent",
  buyer: "buyers",
  client: "clients"
};

type DeleteImpact = {
  recordCount: number;
  linkedMediaCount: number;
  records: Array<{ id: string; code: string | null }>;
};

type DeleteTransactionResult = {
  deletedRecordIds: string[];
  deletedMediaIds: string[];
  deletedTaskCount: number;
  deletedTimelineCount: number;
  deletedAuditLogCount: number;
  clearedIntakeSessionCount: number;
  deletedHierarchyLinkCount: number;
};

type DeleteResult = DeleteTransactionResult & {
  deletedMediaCount: number;
  storageWarnings: string[];
  storageCleanup: {
    attemptedObjectCount: number;
    deletedObjectCount: number;
    queuedObjectCount: number;
    warningCount: number;
  };
};

async function fetchExistingRecords(input: { type: GridType; recordIds: string[] }) {
  const supabase = createSupabaseAdminClient();
  const table = tableByType[input.type];
  const { data, error } = await supabase
    .from(table)
    .select("id,code")
    .in("id", input.recordIds);

  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id: String(row.id),
    code: row.code ? String(row.code) : null
  }));
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

function readNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function deleteRecordsInTransaction(input: { type: GridType; recordIds: string[] }): Promise<DeleteTransactionResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("delete_crm_records_transactional", {
    p_type: input.type,
    p_record_ids: input.recordIds
  });

  if (error) throw new Error(error.message);
  const payload = (data || {}) as Record<string, unknown>;

  return {
    deletedRecordIds: readStringArray(payload.deleted_record_ids),
    deletedMediaIds: readStringArray(payload.deleted_media_ids),
    deletedTaskCount: readNumber(payload.deleted_task_count),
    deletedTimelineCount: readNumber(payload.deleted_timeline_count),
    deletedAuditLogCount: readNumber(payload.deleted_audit_log_count),
    clearedIntakeSessionCount: readNumber(payload.cleared_intake_session_count),
    deletedHierarchyLinkCount: readNumber(payload.deleted_hierarchy_link_count)
  };
}

export async function fetchRecordDeleteImpact(input: { type: GridType; recordIds: string[] }): Promise<DeleteImpact> {
  if (input.recordIds.length === 0) return { recordCount: 0, linkedMediaCount: 0, records: [] };

  const supabase = createSupabaseAdminClient();
  const table = tableByType[input.type];
  const existingRecords = await fetchExistingRecords(input);

  if (existingRecords.length === 0) {
    throw new Error("No matching records were found for deletion.");
  }

  const { count: linkedMediaCount, error: mediaCountError } = await supabase
    .from("media")
    .select("id", { count: "exact", head: true })
    .eq("record_type", table)
    .in("record_id", existingRecords.map((record) => record.id));

  if (mediaCountError) throw new Error(mediaCountError.message);

  return {
    recordCount: existingRecords.length,
    linkedMediaCount: linkedMediaCount || 0,
    records: existingRecords
  };
}

export async function deleteRecords(input: { type: GridType; recordIds: string[] }): Promise<DeleteResult> {
  if (input.recordIds.length === 0) {
    throw new Error("Select at least one record to delete.");
  }

  const table = tableByType[input.type];
  const existingRecords = await fetchExistingRecords(input);

  if (existingRecords.length === 0) {
    throw new Error("No matching records were found for deletion.");
  }

  const existingRecordIds = existingRecords.map((record) => record.id);
  const mediaSnapshots = await fetchMediaDeleteSnapshotsForRecordSet({
    recordType: table,
    recordIds: existingRecordIds
  });

  const transactionResult = await deleteRecordsInTransaction({
    type: input.type,
    recordIds: existingRecordIds
  });

  const storageCleanup = await deleteStorageObjectsForMediaSnapshots({
    snapshots: mediaSnapshots,
    reason: "record_delete_after_db_commit",
    context: {
      source: "grid_record_delete",
      grid_type: input.type,
      deleted_record_ids: transactionResult.deletedRecordIds
    }
  });

  return {
    ...transactionResult,
    deletedMediaCount: transactionResult.deletedMediaIds.length,
    storageWarnings: storageCleanup.warnings,
    storageCleanup: {
      attemptedObjectCount: storageCleanup.attemptedObjectCount,
      deletedObjectCount: storageCleanup.deletedObjectCount,
      queuedObjectCount: storageCleanup.queuedObjectCount,
      warningCount: storageCleanup.warningCount
    }
  };
}
