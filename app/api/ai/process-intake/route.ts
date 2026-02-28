import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { getRequestActor } from "@/services/auth/role.service";
import { checkRateLimit } from "@/lib/rate-limit";
import { detectTypeAndLanguage, detectMultipleListings, extractByType, validateAndNormalize, ExtractionParseError } from "@/services/ai/intake-processing.service";

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
      .select("id, raw_text, parent_session_id, ai_meta")
      .eq("id", intake_session_id)
      .single();

    if (fetchError || !session) {
      console.error("[process-intake] intake session fetch failed", { intake_session_id, fetchError });
      return NextResponse.json({ error: fetchError?.message || "Intake session not found" }, { status: 404 });
    }

    const detected = await detectTypeAndLanguage(session.raw_text);
    const multi = await detectMultipleListings(session.raw_text);

    if (!session.parent_session_id && multi.multi_listing) {
      const existingChildren = await supabase
        .from("intake_sessions")
        .select("id")
        .eq("parent_session_id", intake_session_id)
        .limit(50);

      const childIds = (existingChildren.data || []).map((row) => String(row.id));

      if (childIds.length === 0) {
        const childRows = multi.segments.map((segment, index) => ({
          parent_session_id: intake_session_id,
          raw_text: segment,
          status: "draft",
          type_detected: "",
          type_confirmed: "",
          ai_json: {},
          ai_meta: {
            split_from_parent: intake_session_id,
            split_index: index + 1,
            split_total: multi.segments.length
          },
          completeness_score: 0
        }));

        const inserted = await supabase.from("intake_sessions").insert(childRows).select("id");
        if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 });
        childIds.push(...(inserted.data || []).map((row) => String(row.id)));
      }

      const mergedMeta = {
        ...((session.ai_meta || {}) as Record<string, unknown>),
        detect_confidence: detected.confidence,
        language: detected.language,
        normalized_text: detected.normalized_text,
        signals: detected.signals,
        multi_listing: true,
        child_count: childIds.length,
        child_ids: childIds
      };

      const { error: parentUpdateError } = await supabase
        .from("intake_sessions")
        .update({
          type_detected: detected.detected_type,
          ai_meta: mergedMeta,
          status: "needs_review"
        })
        .eq("id", intake_session_id);
      if (parentUpdateError) return NextResponse.json({ error: parentUpdateError.message }, { status: 500 });

      await supabase.from("timeline").insert({
        record_type: "intake_sessions",
        record_id: intake_session_id,
        action: `Split into ${childIds.length} listings`,
        details: { child_ids: childIds }
      });

      return NextResponse.json({
        detected_type: detected.detected_type,
        confidence: detected.confidence,
        multi_listing: true,
        child_ids: childIds
      });
    }

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
          signals: detected.signals,
          multi_listing: false
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
