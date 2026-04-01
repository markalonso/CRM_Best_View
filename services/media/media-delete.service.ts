import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type StorageTarget = {
  bucket: string;
  path: string;
};

export type MediaDeleteSnapshot = {
  media: {
    id: string;
    original_filename: string;
    record_type: string | null;
    record_id: string | null;
    intake_session_id: string | null;
  };
  storageTargets: StorageTarget[];
};

export type StorageCleanupSummary = {
  attemptedObjectCount: number;
  deletedObjectCount: number;
  queuedObjectCount: number;
  warningCount: number;
  warnings: string[];
};

function parseStoragePathFromPublicUrl(url: string): StorageTarget | null {
  try {
    const parsed = new URL(url);
    const marker = "/object/public/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex === -1) return null;

    const tail = parsed.pathname.slice(markerIndex + marker.length);
    const [bucket, ...pathParts] = tail.split("/").filter(Boolean);
    const path = decodeURIComponent(pathParts.join("/"));
    if (!bucket || !path) return null;
    return { bucket, path };
  } catch {
    return null;
  }
}

function buildStorageTargets(row: Record<string, unknown>) {
  const targets: StorageTarget[] = [];
  const storagePath = String(row.storage_path || "").trim();
  const publicUrl = String(row.file_url || "").trim();
  const fromPublicUrl = publicUrl ? parseStoragePathFromPublicUrl(publicUrl) : null;

  if (fromPublicUrl) targets.push(fromPublicUrl);
  if (storagePath) {
    targets.push({ bucket: "crm-media", path: storagePath });
    targets.push({ bucket: "media", path: storagePath });
  }

  const deduped = new Map<string, StorageTarget>();
  for (const target of targets) {
    deduped.set(`${target.bucket}:${target.path}`, target);
  }
  return Array.from(deduped.values());
}

function normalizeMediaDeleteSnapshot(row: Record<string, unknown>): MediaDeleteSnapshot {
  return {
    media: {
      id: String(row.id || ""),
      original_filename: String(row.original_filename || ""),
      record_type: row.record_type ? String(row.record_type) : null,
      record_id: row.record_id ? String(row.record_id) : null,
      intake_session_id: row.intake_session_id ? String(row.intake_session_id) : null
    },
    storageTargets: buildStorageTargets(row)
  };
}

export async function fetchMediaDeleteSnapshot(input: { mediaId: string }) {
  const supabase = createSupabaseAdminClient();
  const { data: mediaRow, error: mediaError } = await supabase
    .from("media")
    .select("id,original_filename,storage_path,file_url,record_type,record_id,intake_session_id")
    .eq("id", input.mediaId)
    .maybeSingle();

  if (mediaError) throw new Error(mediaError.message);
  if (!mediaRow) throw new Error("Media item not found");
  return normalizeMediaDeleteSnapshot(mediaRow as Record<string, unknown>);
}

export async function fetchMediaDeleteSnapshotsForRecordSet(input: {
  recordType: string;
  recordIds: string[];
}) {
  if (input.recordIds.length === 0) return [] as MediaDeleteSnapshot[];

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("media")
    .select("id,original_filename,storage_path,file_url,record_type,record_id,intake_session_id")
    .eq("record_type", input.recordType)
    .in("record_id", input.recordIds);

  if (error) throw new Error(error.message);
  return (data || []).map((row) => normalizeMediaDeleteSnapshot(row as Record<string, unknown>));
}

async function markStorageCleanupResolved(target: StorageTarget) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("storage_cleanup_queue")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      last_error: null
    })
    .eq("bucket", target.bucket)
    .eq("path", target.path)
    .eq("status", "pending");

  if (error) {
    console.error("[storage-cleanup] failed to mark cleanup row resolved", {
      bucket: target.bucket,
      path: target.path,
      error: error.message
    });
  }
}

async function queueStorageCleanupFailure(input: {
  target: StorageTarget;
  snapshot: MediaDeleteSnapshot;
  reason: string;
  message: string;
  context?: Record<string, unknown>;
}) {
  const supabase = createSupabaseAdminClient();
  const payload = {
    entity_type: "media",
    entity_id: input.snapshot.media.id,
    bucket: input.target.bucket,
    path: input.target.path,
    status: "pending",
    reason: input.reason,
    last_error: input.message,
    context_json: {
      media_id: input.snapshot.media.id,
      original_filename: input.snapshot.media.original_filename,
      record_type: input.snapshot.media.record_type,
      record_id: input.snapshot.media.record_id,
      intake_session_id: input.snapshot.media.intake_session_id,
      ...(input.context || {})
    }
  };

  const { error } = await supabase
    .from("storage_cleanup_queue")
    .upsert(payload, { onConflict: "bucket,path,status" });

  if (error) {
    console.error("[storage-cleanup] failed to enqueue cleanup row", {
      bucket: input.target.bucket,
      path: input.target.path,
      error: error.message
    });
    return false;
  }

  return true;
}

export async function deleteStorageObjectsForMediaSnapshots(input: {
  snapshots: MediaDeleteSnapshot[];
  reason: string;
  context?: Record<string, unknown>;
}) {
  const supabase = createSupabaseAdminClient();
  const warnings: string[] = [];
  let attemptedObjectCount = 0;
  let deletedObjectCount = 0;
  let queuedObjectCount = 0;

  for (const snapshot of input.snapshots) {
    for (const target of snapshot.storageTargets) {
      attemptedObjectCount += 1;

      const { error } = await supabase.storage.from(target.bucket).remove([target.path]);
      if (!error) {
        deletedObjectCount += 1;
        await markStorageCleanupResolved(target);
        continue;
      }

      const normalized = error.message.toLowerCase();
      if (normalized.includes("not found") || normalized.includes("no such object")) {
        deletedObjectCount += 1;
        await markStorageCleanupResolved(target);
        continue;
      }

      const warning = `${target.bucket}:${target.path} -> ${error.message}`;
      warnings.push(warning);

      const queued = await queueStorageCleanupFailure({
        target,
        snapshot,
        reason: input.reason,
        message: error.message,
        context: input.context
      });
      if (queued) {
        queuedObjectCount += 1;
      } else {
        warnings.push(`queue:${target.bucket}:${target.path} -> failed to queue storage cleanup retry`);
      }
    }
  }

  const summary: StorageCleanupSummary = {
    attemptedObjectCount,
    deletedObjectCount,
    queuedObjectCount,
    warningCount: warnings.length,
    warnings
  };

  return summary;
}

export async function deleteMediaItem(input: { mediaId: string }) {
  const supabase = createSupabaseAdminClient();
  const snapshot = await fetchMediaDeleteSnapshot(input);

  const { error: deleteError } = await supabase.from("media").delete().eq("id", input.mediaId);
  if (deleteError) throw new Error(deleteError.message);

  const storageCleanup = await deleteStorageObjectsForMediaSnapshots({
    snapshots: [snapshot],
    reason: "media_delete_after_db_commit",
    context: {
      source: "media_delete_api"
    }
  });

  return {
    media: snapshot.media,
    storageWarnings: storageCleanup.warnings,
    storageCleanup
  };
}
