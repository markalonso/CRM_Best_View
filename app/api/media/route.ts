import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { getRequestActor, requireAdminActor } from "@/services/auth/role.service";
import { assignMediaToHierarchyNode } from "@/services/hierarchy/hierarchy.service";
import { buildMediaPath, detectMediaType, mediaStorageProvider } from "@/services/media/media-manager.service";

const recordLinkColumnByRecordType = {
  properties_sale: "sale_id",
  properties_rent: "rent_id",
  buyers: "buyer_id",
  clients: "client_id"
} as const;

async function resolveRecordHierarchyNodeId(recordType: string, recordId: string) {
  const linkColumn = recordLinkColumnByRecordType[recordType as keyof typeof recordLinkColumnByRecordType];
  if (!linkColumn || !recordId) return "";

  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("record_hierarchy_links")
    .select("node_id")
    .eq(linkColumn, recordId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return String(data?.node_id || "");
}

export async function GET(request: NextRequest) {
  const actor = await getRequestActor(request);
  if (!actor.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createSupabaseClient();
  const { searchParams } = new URL(request.url);
  const intakeSessionId = searchParams.get("intake_session_id");
  const recordType = searchParams.get("record_type");
  const recordId = searchParams.get("record_id");
  if (actor.role === "agent" && recordType && !["properties_sale", "properties_rent"].includes(recordType)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = supabase
    .from("media")
    .select("id, file_url, mime_type, media_type, original_filename, file_size, created_at, intake_session_id, record_type, record_id")
    .order("created_at", { ascending: false })
    .limit(200);

  if (intakeSessionId) query = query.eq("intake_session_id", intakeSessionId);
  if (recordType) query = query.eq("record_type", recordType);
  if (recordId) query = query.eq("record_id", recordId);
  if (actor.role === "agent" && !recordType) {
    query = query.in("record_type", ["properties_sale", "properties_rent"]);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ media: data || [] });
}

export async function POST(request: NextRequest) {
  const { actor, errorResponse } = await requireAdminActor(request);
  if (errorResponse) return errorResponse;

  const supabase = createSupabaseClient();
  const form = await request.formData();

  const intakeSessionId = String(form.get("intake_session_id") || "").trim();
  const recordType = String(form.get("record_type") || "").trim();
  const recordId = String(form.get("record_id") || "").trim();
  const files = form.getAll("files").filter((v): v is File => v instanceof File);

  if (files.length === 0) return NextResponse.json({ error: "No files" }, { status: 400 });
  if (!intakeSessionId && !(recordType && recordId)) {
    return NextResponse.json({ error: "intake_session_id or record_type+record_id required" }, { status: 400 });
  }

  const duplicates: string[] = [];
  const duplicateSig = new Set<string>();
  if (intakeSessionId) {
    const { data: existing } = await supabase
      .from("media")
      .select("original_filename, file_size")
      .eq("intake_session_id", intakeSessionId);

    const sig = new Set((existing || []).map((m) => `${m.original_filename}|${m.file_size ?? 0}`));
    for (const f of files) {
      const key = `${f.name}|${f.size}`;
      if (sig.has(key)) {
        duplicates.push(f.name);
        duplicateSig.add(key);
      }
    }
  }

  const toUpload = files.filter((f) => !duplicateSig.has(`${f.name}|${f.size}`));
  const records: Array<Record<string, unknown>> = [];

  for (const file of toUpload) {
    const path = buildMediaPath({
      filename: file.name,
      intakeSessionId: intakeSessionId || undefined,
      recordType: recordType || undefined,
      recordId: recordId || undefined
    });

    const uploaded = await mediaStorageProvider.upload(path, file);
    const mediaType = detectMediaType(file.type || "");

    records.push({
      record_type: recordType || null,
      record_id: recordId || null,
      intake_session_id: intakeSessionId || null,
      storage_path: path,
      file_url: uploaded.publicUrl,
      mime_type: file.type || "application/octet-stream",
      media_type: mediaType,
      original_filename: file.name,
      file_size: file.size
    });
  }

  let inserted: Array<{ id: string }> = [];
  if (records.length > 0) {
    const { data, error } = await supabase.from("media").insert(records).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    inserted = (data || []) as Array<{ id: string }>;
  }

  const hierarchyWarnings: string[] = [];
  if (recordType && recordId && inserted.length > 0) {
    try {
      const hierarchyNodeId = await resolveRecordHierarchyNodeId(recordType, recordId);
      if (hierarchyNodeId) {
        for (const row of inserted) {
          await assignMediaToHierarchyNode({ mediaId: String(row.id), nodeId: hierarchyNodeId, actorUserId: actor.userId });
        }
      }
    } catch (error) {
      hierarchyWarnings.push(error instanceof Error ? error.message : "Failed to assign media to hierarchy node");
    }
  }

  return NextResponse.json({ ok: true, uploaded: records.length, skippedDuplicates: duplicates, hierarchyWarnings });
}
