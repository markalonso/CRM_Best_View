import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { buildMediaPath, detectMediaType, mediaStorageProvider } from "@/services/media/media-manager.service";
import { getIntegrationKey } from "@/lib/env";
import { writeAuditLog } from "@/services/audit/audit-log.service";

type InputMedia = { url?: string; type?: string; filename?: string };

type IntakeWebhookPayload = {
  source?: "voiceflow" | "telegram" | "form" | "other" | string;
  raw_text?: string;
  suggested_type?: "sale" | "rent" | "buyer" | "client" | "other" | "";
  contact?: { name?: string; phone?: string };
  media?: InputMedia[];
  external_id?: string;
  metadata?: Record<string, unknown>;

  text?: string;
  message?: string;
  transcript?: string;
  attachments?: InputMedia[];
};

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const MEDIA_FETCH_TIMEOUT_MS = 10_000;

function normalizePayload(payload: IntakeWebhookPayload) {
  const rawText = String(payload.raw_text || payload.text || payload.message || payload.transcript || "").trim();
  const source = String(payload.source || "other").toLowerCase();
  const suggestedType = String(payload.suggested_type || "").toLowerCase();
  const media = [...(Array.isArray(payload.media) ? payload.media : []), ...(Array.isArray(payload.attachments) ? payload.attachments : [])];

  return {
    source,
    raw_text: rawText,
    suggested_type: ["sale", "rent", "buyer", "client", "other"].includes(suggestedType) ? suggestedType : "",
    contact: payload.contact || {},
    media,
    external_id: payload.external_id || "",
    metadata: payload.metadata || {}
  };
}

function mapIncomingMediaType(type: string | undefined, mimeType: string) {
  const t = String(type || "").toLowerCase();
  if (t === "image") return "image" as const;
  if (t === "video") return "video" as const;
  if (t === "doc" || t === "document") return "document" as const;
  return detectMediaType(mimeType);
}

async function fetchMedia(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to download media (${response.status})`);

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_MEDIA_BYTES) throw new Error("Media exceeds allowed size");

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_MEDIA_BYTES) throw new Error("Media exceeds allowed size");

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    return { bytes: arrayBuffer, contentType, size: arrayBuffer.byteLength };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  const key = request.headers.get("x-integration-key") || "";
  const integrationKey = getIntegrationKey();
  if (!integrationKey) return NextResponse.json({ error: "Server misconfigured: missing INTEGRATION_KEY" }, { status: 500 });
  if (!key || key !== integrationKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as IntakeWebhookPayload;
  const payload = normalizePayload(body);
  if (!payload.raw_text) return NextResponse.json({ error: "raw_text is required" }, { status: 400 });

  const supabase = createSupabaseClient();

  const aiMeta = {
    integration_source: payload.source,
    external_id: payload.external_id || null,
    contact: payload.contact,
    metadata: payload.metadata
  };

  const { data: session, error: sessionError } = await supabase
    .from("intake_sessions")
    .insert({
      raw_text: payload.raw_text,
      status: "draft",
      type_detected: "",
      type_confirmed: payload.suggested_type,
      ai_json: {},
      ai_meta: aiMeta,
      completeness_score: 0
    })
    .select("id")
    .single();

  if (sessionError || !session) return NextResponse.json({ error: sessionError?.message || "Unable to create intake session" }, { status: 500 });

  const mediaRecords: Array<Record<string, unknown>> = [];
  const mediaErrors: Array<{ url: string; error: string }> = [];

  for (let i = 0; i < payload.media.length; i += 1) {
    const media = payload.media[i];
    const url = String(media.url || "").trim();
    if (!url) continue;

    try {
      const downloaded = await fetchMedia(url);
      const filename = String(media.filename || `upload_${i + 1}`)
        .replace(/[^\w\-.\u0600-\u06FF]/g, "_")
        .slice(0, 140);

      const file = new File([downloaded.bytes], filename || `upload_${i + 1}`, { type: downloaded.contentType });
      const path = buildMediaPath({ intakeSessionId: session.id, filename: file.name });
      const upload = await mediaStorageProvider.upload(path, file);

      const mediaType = mapIncomingMediaType(media.type, downloaded.contentType);
      mediaRecords.push({
        intake_session_id: session.id,
        record_type: null,
        record_id: null,
        linked_record_type: null,
        linked_record_id: null,
        file_url: upload.publicUrl,
        mime_type: downloaded.contentType,
        media_type: mediaType,
        type: mediaType,
        original_filename: file.name,
        file_size: downloaded.size
      });
    } catch (error) {
      mediaErrors.push({ url, error: error instanceof Error ? error.message : "Failed to process media" });
    }
  }

  if (mediaRecords.length) {
    const { error } = await supabase.from("media").insert(mediaRecords);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAuditLog({
    user_id: null,
    action: "integration_intake_create",
    record_type: "intake_sessions",
    record_id: session.id,
    before_json: {},
    after_json: { source: payload.source, suggested_type: payload.suggested_type, media_imported: mediaRecords.length },
    source: payload.source || "integration"
  });

  return NextResponse.json({
    intake_session_id: session.id,
    status: "draft",
    media_imported: mediaRecords.length,
    media_errors: mediaErrors
  });
}
