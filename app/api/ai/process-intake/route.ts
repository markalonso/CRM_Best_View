import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { getRequestActor } from "@/services/auth/role.service";
import { checkRateLimit } from "@/lib/rate-limit";
import { detectTypeAndLanguage, extractByType, validateAndNormalize, ExtractionParseError } from "@/services/ai/intake-processing.service";

export async function POST(request: NextRequest) {
  const supabase = createSupabaseClient();

  try {
    const actor = await getRequestActor(request);
    const key = actor.userId || request.headers.get("x-forwarded-for") || "anon";
    const rl = checkRateLimit(`ai:${key}`, 20, 60_000);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    const { intake_session_id } = await request.json();
    if (!intake_session_id) {
      return NextResponse.json({ error: "intake_session_id is required" }, { status: 400 });
    }

    const { data: session, error: fetchError } = await supabase
      .from("intake_sessions")
      .select("id, raw_text")
      .eq("id", intake_session_id)
      .single();

    if (fetchError || !session) {
      console.error("[process-intake] intake session fetch failed", { intake_session_id, fetchError });
      return NextResponse.json({ error: fetchError?.message || "Intake session not found" }, { status: 404 });
    }

    const detected = await detectTypeAndLanguage(session.raw_text);

    let extracted: Record<string, unknown> = {};
    try {
      extracted = await extractByType(detected.detected_type, detected.normalized_text);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown extraction parse failure";
      console.error("[process-intake] extraction failed", { intake_session_id, reason, detected_type: detected.detected_type });

      await supabase
        .from("intake_sessions")
        .update({
          type_detected: detected.detected_type,
          status: "needs_review",
          ai_meta: {
            language: detected.language,
            detect_confidence: detected.confidence,
            extraction_error: reason,
            normalized_text: detected.normalized_text
          }
        })
        .eq("id", intake_session_id);

      return NextResponse.json({ error: reason, detected_type: detected.detected_type }, { status: error instanceof ExtractionParseError ? 422 : 500 });
    }

    const validated = validateAndNormalize(detected.detected_type, extracted, detected.normalized_text);
    const nextStatus = validated.missing_fields.length > 0 ? "needs_review" : "draft";

    const { error: updateError } = await supabase
      .from("intake_sessions")
      .update({
        type_detected: detected.detected_type,
        ai_json: validated.normalized_json,
        ai_meta: {
          language: detected.language,
          confidence_map: validated.confidence_map,
          missing_fields: validated.missing_fields,
          detect_confidence: detected.confidence,
          normalized_text: detected.normalized_text,
          extracted_json: extracted,
          signals: detected.signals
        },
        status: nextStatus
      })
      .eq("id", intake_session_id);

    if (updateError) {
      console.error("[process-intake] update failed", { intake_session_id, updateError });
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      detected_type: detected.detected_type,
      confidence: detected.confidence,
      extracted_json: extracted,
      normalized_json: validated.normalized_json,
      missing_fields: validated.missing_fields,
      confidence_map: validated.confidence_map
    });
  } catch (error) {
    console.error("[process-intake] unexpected error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
