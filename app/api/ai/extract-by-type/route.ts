import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseClient } from "@/services/supabase/client";
import { getRequestActor } from "@/services/auth/role.service";
import { checkRateLimit } from "@/lib/rate-limit";
import { detectTypeAndLanguage, extractByType, validateAndNormalize, ExtractionParseError, type IntakeType } from "@/services/ai/intake-processing.service";

const payloadSchema = z.object({
  intake_session_id: z.string().uuid(),
  forced_type: z.enum(["sale", "rent", "buyer", "client"])
});

export async function POST(request: NextRequest) {
  const supabase = createSupabaseClient();

  try {
    const actor = await getRequestActor(request);
    const key = actor.userId || request.headers.get("x-forwarded-for") || "anon";
    const rl = checkRateLimit(`ai:${key}`, 20, 60_000);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    const payload = payloadSchema.parse(await request.json());

    const { data: session, error: fetchError } = await supabase
      .from("intake_sessions")
      .select("id, raw_text")
      .eq("id", payload.intake_session_id)
      .single();

    if (fetchError || !session) {
      return NextResponse.json({ error: fetchError?.message || "Intake session not found" }, { status: 404 });
    }

    const detected = await detectTypeAndLanguage(session.raw_text);
    const forcedType = payload.forced_type as IntakeType;

    let extracted: Record<string, unknown> = {};
    try {
      extracted = await extractByType(forcedType, detected.normalized_text);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown extraction parse failure";

      await supabase
        .from("intake_sessions")
        .update({
          status: "needs_review",
          ai_meta: {
            language: detected.language,
            detect_confidence: detected.confidence,
            extraction_error: reason,
            normalized_text: detected.normalized_text,
            forced_type: forcedType
          }
        })
        .eq("id", payload.intake_session_id);

      return NextResponse.json({ error: reason, forced_type: forcedType }, { status: error instanceof ExtractionParseError ? 422 : 500 });
    }

    const validated = validateAndNormalize(forcedType, extracted, detected.normalized_text);
    const nextStatus = validated.missing_fields.length > 0 ? "needs_review" : "draft";

    const { error: updateError } = await supabase
      .from("intake_sessions")
      .update({
        type_detected: forcedType,
        ai_json: validated.normalized_json,
        ai_meta: {
          language: detected.language,
          confidence_map: validated.confidence_map,
          missing_fields: validated.missing_fields,
          detect_confidence: detected.confidence,
          normalized_text: detected.normalized_text,
          extracted_json: extracted,
          signals: detected.signals,
          forced_type: forcedType
        },
        status: nextStatus
      })
      .eq("id", payload.intake_session_id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      detected_type: forcedType,
      confidence: detected.confidence,
      extracted_json: extracted,
      normalized_json: validated.normalized_json,
      missing_fields: validated.missing_fields,
      confidence_map: validated.confidence_map
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
