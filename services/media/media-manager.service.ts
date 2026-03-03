import { SupabaseMediaProvider } from "./supabase-media-provider";

export const mediaStorageProvider = new SupabaseMediaProvider();

export function buildMediaPath(input: {
  recordType?: string;
  recordId?: string;
  intakeSessionId?: string;
  filename: string;
}) {
  const safe = input.filename.replace(/\s+/g, "_");
  const unique = `${Date.now()}_${safe}`;

  if (input.recordType && input.recordId) {
    return `media/${input.recordType}/${input.recordId}/${unique}`;
  }

  if (input.intakeSessionId) {
    return `intake_sessions/${input.intakeSessionId}/${unique}`;
  }

  throw new Error("Either recordType+recordId or intakeSessionId is required");
}

export function detectMediaType(mimeType: string): "image" | "video" | "document" | "other" {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.includes("pdf") || mime.includes("word") || mime.includes("sheet") || mime.includes("document")) return "document";
  return "other";
}
