import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseClient();

  const { data: session, error } = await supabase
    .from("intake_sessions")
    .select("id, status, created_at, updated_at, type_detected, type_confirmed, raw_text, ai_json, ai_meta, completeness_score")
    .eq("id", params.id)
    .single();

  if (error || !session) {
    return NextResponse.json({ error: error?.message || "Session not found" }, { status: 404 });
  }

  const { data: media, error: mediaError } = await supabase
    .from("media")
    .select("id, file_url, media_type, mime_type, original_filename, file_size, created_at, record_id, record_type")
    .eq("intake_session_id", params.id)
    .order("created_at", { ascending: false });

  if (mediaError) {
    return NextResponse.json({ error: mediaError.message }, { status: 500 });
  }

  return NextResponse.json({ session, media: media || [] });
}
