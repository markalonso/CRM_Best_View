import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { buildMediaPath, detectMediaType, mediaStorageProvider } from "@/services/media/media-manager.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { writeAuditLog } from "@/services/audit/audit-log.service";

type IntakeStatus = "draft" | "needs_review" | "confirmed";
type IntakeType = "sale" | "rent" | "buyer" | "client" | "other" | "";

export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient();
  const actor = await getRequestActor(request);
  if (!actor.userId) {
    console.warn("[inbox/sessions] unauthorized GET", { hasSession: false });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const status = searchParams.get("status") as IntakeStatus | null;
  const type = searchParams.get("type") as IntakeType | null;
  const hasMedia = searchParams.get("hasMedia");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  let query = supabase
    .from("intake_sessions")
    .select("id, parent_session_id, status, created_at, type_detected, type_confirmed, raw_text, ai_json, ai_meta, completeness_score")
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) query = query.eq("status", status);
  if (type) query = query.eq("type_detected", type);
  if (startDate) query = query.gte("created_at", new Date(startDate).toISOString());
  if (endDate) query = query.lte("created_at", new Date(endDate).toISOString());

  const { data: sessions, error } = await query;
  if (error) {
    if (error.code === "42501") {
      console.warn("[inbox/sessions] forbidden GET", { hasSession: true, userId: actor.userId });
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (sessions || []).map((s) => s.id);
  const { data: mediaRows, error: mediaError } = ids.length
    ? await supabase
        .from("media")
        .select("id, intake_session_id, file_url, media_type, mime_type, original_filename, file_size, created_at")
        .in("intake_session_id", ids)
    : { data: [], error: null };

  if (mediaError) return NextResponse.json({ error: mediaError.message }, { status: 500 });

  const mediaBySession = new Map<string, Array<Record<string, unknown>>>();
  for (const row of mediaRows || []) {
    const list = mediaBySession.get(String(row.intake_session_id)) || [];
    list.push(row as Record<string, unknown>);
    mediaBySession.set(String(row.intake_session_id), list);
  }

  let result = (sessions || []).map((session) => {
    const media = (mediaBySession.get(session.id) || []).map((m) => ({
      id: String(m.id),
      file_url: String(m.file_url),
      type: String(m.media_type || "other"),
      media_type: String(m.media_type || "other"),
      mime_type: String(m.mime_type || ""),
      original_filename: String(m.original_filename || ""),
      file_size: Number(m.file_size || 0),
      created_at: String(m.created_at)
    }));

    const photos = media.filter((m) => m.media_type === "image").length;
    const videos = media.filter((m) => m.media_type === "video").length;
    const docs = media.filter((m) => m.media_type === "document" || m.media_type === "other").length;

    const source = String((session.ai_meta as { integration_source?: string } | null)?.integration_source || "manual");

    return {
      ...session,
      source,
      media,
      media_counts: { photos, videos, docs },
      confidence: Number((session.ai_meta as { detect_confidence?: number } | null)?.detect_confidence || 0)
    };
  });

  if (hasMedia === "true") result = result.filter((row) => row.media.length > 0);
  if (q) {
    result = result.filter((row) => `${row.raw_text} ${JSON.stringify(row.ai_json || {})}`.toLowerCase().includes(q));
  }

  const parentIds = result.filter((row) => !row.parent_session_id).map((row) => row.id);
  const childRows = result.filter((row) => !!row.parent_session_id);
  const childByParent = new Map<string, Array<Record<string, unknown>>>();

  for (const child of childRows) {
    const key = String(child.parent_session_id || "");
    if (!key) continue;
    const list = childByParent.get(key) || [];
    list.push(child);
    childByParent.set(key, list);
  }

  const parentsFirst = result
    .filter((row) => !row.parent_session_id)
    .map((row) => {
      const children = (childByParent.get(row.id) || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return {
        ...row,
        children,
        child_count: children.length,
        multi_listing: Boolean((row.ai_meta as { multi_listing?: boolean } | null)?.multi_listing) || children.length > 1
      };
    });

  if (parentIds.length === 0) {
    return NextResponse.json({ sessions: result.map((row) => ({ ...row, children: [], child_count: 0, multi_listing: false })) });
  }

  return NextResponse.json({ sessions: parentsFirst });
}

export async function POST(request: NextRequest) {
  const supabase = createSupabaseClient();
  const actor = await getRequestActor(request);
  if (!actor.userId) {
    console.warn("[inbox/sessions] unauthorized POST", { hasSession: false });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasRole(actor.role, "agent")) {
    console.warn("[inbox/sessions] forbidden POST", { hasSession: true, userId: actor.userId, role: actor.role });
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const formData = await request.formData();
  const rawText = String(formData.get("raw_text") || "").trim();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);

  if (!rawText) return NextResponse.json({ error: "raw_text is required" }, { status: 400 });

  const { data: session, error: sessionError } = await supabase
    .from("intake_sessions")
    .insert({ raw_text: rawText, status: "draft", type_detected: "", type_confirmed: "", ai_json: {}, completeness_score: 0, created_by: actor.userId })
    .select("id")
    .single();

  if (sessionError || !session) return NextResponse.json({ error: sessionError?.message || "Unable to create intake session" }, { status: 500 });

  const seen = new Set<string>();
  const duplicates: string[] = [];
  const records: Array<Record<string, unknown>> = [];

  for (const file of files) {
    const sig = `${file.name}|${file.size}`;
    if (seen.has(sig)) {
      duplicates.push(file.name);
      continue;
    }
    seen.add(sig);

    const path = buildMediaPath({ intakeSessionId: session.id, filename: file.name });
    const upload = await mediaStorageProvider.upload(path, file);
    const mediaType = detectMediaType(file.type || "");

    records.push({
      intake_session_id: session.id,
      record_type: null,
      record_id: null,
      linked_record_type: null,
      linked_record_id: null,
      file_url: upload.publicUrl,
      mime_type: file.type || "application/octet-stream",
      media_type: mediaType,
      type: mediaType,
      original_filename: file.name,
      file_size: file.size
    });
  }

  if (records.length) {
    const { error: mediaInsertError } = await supabase.from("media").insert(records);
    if (mediaInsertError) return NextResponse.json({ error: mediaInsertError.message }, { status: 500 });
  }

  await writeAuditLog({
    user_id: actor.userId,
    action: "create_intake",
    record_type: "intake_sessions",
    record_id: session.id,
    before_json: {},
    after_json: { raw_text: rawText, status: "draft" },
    source: "inbox"
  });

  return NextResponse.json({ ok: true, session_id: session.id, skippedDuplicates: duplicates });
}
