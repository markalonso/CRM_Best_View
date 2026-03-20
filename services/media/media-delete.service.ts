import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type StorageTarget = {
  bucket: string;
  path: string;
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

export async function deleteMediaItem(input: { mediaId: string }) {
  const supabase = createSupabaseAdminClient();
  const { data: mediaRow, error: mediaError } = await supabase
    .from("media")
    .select("id,original_filename,storage_path,file_url,record_type,record_id,intake_session_id")
    .eq("id", input.mediaId)
    .maybeSingle();

  if (mediaError) throw new Error(mediaError.message);
  if (!mediaRow) throw new Error("Media item not found");

  const targets = buildStorageTargets(mediaRow as Record<string, unknown>);

  const { error: deleteError } = await supabase.from("media").delete().eq("id", input.mediaId);
  if (deleteError) throw new Error(deleteError.message);

  const storageWarnings: string[] = [];
  for (const target of targets) {
    const { error } = await supabase.storage.from(target.bucket).remove([target.path]);
    if (!error) continue;

    const normalized = error.message.toLowerCase();
    if (normalized.includes("not found") || normalized.includes("no such object")) continue;
    storageWarnings.push(`${target.bucket}:${target.path} -> ${error.message}`);
  }

  return {
    media: {
      id: String(mediaRow.id),
      original_filename: String(mediaRow.original_filename || ""),
      record_type: mediaRow.record_type ? String(mediaRow.record_type) : null,
      record_id: mediaRow.record_id ? String(mediaRow.record_id) : null,
      intake_session_id: mediaRow.intake_session_id ? String(mediaRow.intake_session_id) : null
    },
    storageWarnings
  };
}
