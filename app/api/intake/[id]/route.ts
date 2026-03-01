import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";

type ReviewType = "sale" | "rent" | "buyer" | "client" | "other";
type QuestionType = "text" | "number" | "select" | "multiselect" | "phone";

type QuickQuestion = {
  key: string;
  label: string;
  type: QuestionType;
  options?: string[];
};


function asText(value: unknown) {
  return String(value ?? "").trim();
}

function hasPhoneInRaw(rawText: string) {
  return /\+?\d[\d\s()-]{7,}/.test(rawText);
}

function deriveQuestions(type: ReviewType, aiJson: Record<string, unknown>, rawText: string, missingFields: string[]) {
  const questions: QuickQuestion[] = [];
  const add = (q: QuickQuestion) => {
    if (questions.length >= 3) return;
    if (!questions.find((x) => x.key === q.key)) questions.push(q);
  };

  if (type === "sale" || type === "rent") {
    const price = asText(aiJson.price);
    const locationArea = asText(aiJson.location_area);
    const compound = asText(aiJson.compound);
    const phone = asText(aiJson.contact_phone);

    if (!price || missingFields.includes("price")) add({ key: "price", label: "What is the asking price?", type: "number" });
    if ((!locationArea && !compound) || missingFields.includes("location_area")) add({ key: "location_area", label: "Which area/compound is this in?", type: "text" });
    if (!phone && !hasPhoneInRaw(rawText)) add({ key: "contact_phone", label: "What is the contact phone number?", type: "phone" });
  }

  if (type === "buyer") {
    const budgetMin = asText(aiJson.budget_min);
    const budgetMax = asText(aiJson.budget_max);
    const preferredAreas = asText(aiJson.preferred_areas);
    const phone = asText(aiJson.contact_phone);

    if (!budgetMin && !budgetMax) add({ key: "budget_max", label: "What is the budget?", type: "number" });
    if (!preferredAreas || missingFields.includes("preferred_areas")) add({ key: "preferred_areas", label: "Which areas are preferred?", type: "multiselect", options: ["New Cairo", "Maadi", "Zamalek", "Sheikh Zayed", "October", "Nasr City"] });
    if (!phone && !hasPhoneInRaw(rawText)) add({ key: "contact_phone", label: "What is the buyer phone number?", type: "phone" });
  }

  if (type === "client") {
    const name = asText(aiJson.name);
    const phone = asText(aiJson.phone);
    const clientType = asText(aiJson.client_type);

    if (!name && !phone) add({ key: "phone", label: "Client name or phone (at least one)", type: "text" });
    if (!clientType || clientType === "other") add({ key: "client_type", label: "What is the client type?", type: "select", options: ["owner", "seller", "landlord", "broker", "other"] });
  }

  return questions.slice(0, 3);
}

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

  const type = String(session.type_confirmed || session.type_detected || "other") as ReviewType;
  const aiJson = (session.ai_json || {}) as Record<string, unknown>;
  const missingFields = Array.isArray((session.ai_meta as { missing_fields?: unknown[] } | null)?.missing_fields)
    ? ((session.ai_meta as { missing_fields?: unknown[] }).missing_fields || []).map((v) => String(v))
    : [];

  const quick_questions = deriveQuestions(type, aiJson, String(session.raw_text || ""), missingFields);

  return NextResponse.json({ session, media: media || [], quick_questions });
}
