import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { buildMediaPath, detectMediaType, mediaStorageProvider } from "@/services/media/media-manager.service";

export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient();
  const { searchParams } = new URL(request.url);
  const intakeSessionId = searchParams.get("intake_session_id");
  const recordType = searchParams.get("record_type");
  const recordId = searchParams.get("record_id");

  let query = supabase
    .from("media")
    .select("id, file_url, mime_type, media_type, original_filename, file_size, created_at, intake_session_id, record_type, record_id")
    .order("created_at", { ascending: false })
    .limit(200);

  if (intakeSessionId) query = query.eq("intake_session_id", intakeSessionId);
  if (recordType) query = query.eq("record_type", recordType);
  if (recordId) query = query.eq("record_id", recordId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ media: data || [] });
}

export async function POST(request: NextRequest) {
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
      if (sig.has(key)) { duplicates.push(f.name); duplicateSig.add(key); }
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
      file_url: uploaded.publicUrl,
      mime_type: file.type || "application/octet-stream",
      media_type: mediaType,
      type: mediaType,
      original_filename: file.name,
      file_size: file.size,
      linked_record_type: recordType || null,
      linked_record_id: recordId || null
    });
  }

  if (records.length > 0) {
    const { error } = await supabase.from("media").insert(records);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, uploaded: records.length, skippedDuplicates: duplicates });
}
