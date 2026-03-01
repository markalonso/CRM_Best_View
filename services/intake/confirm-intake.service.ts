import "server-only";
import { createSupabaseClient } from "@/services/supabase/client";
import { resolveContactId } from "@/services/contacts/contact-linking.service";

type ReviewType = "sale" | "rent" | "buyer" | "client";
type Mode = "create_new" | "update_existing";
type MergeMode = "keep_existing" | "replace_with_new" | "append";

type ConfirmInput = {
  session_id: string;
  type: ReviewType;
  mode: Mode;
  target_record_id?: string;
  extracted_data: Record<string, unknown>;
  merge_decisions: Record<string, MergeMode>;
};

type ConfirmResult = {
  recordType: "properties_sale" | "properties_rent" | "buyers" | "clients";
  recordId: string;
  status: "active" | "needs_review";
  changedFields: string[];
  mediaSummary: { images: number; videos: number; documents: number; moveWarnings: string[] };
};

const tableByType = {
  sale: "properties_sale",
  rent: "properties_rent",
  buyer: "buyers",
  client: "clients"
} as const;

const codePrefixByType = {
  sale: "SALE",
  rent: "RENT",
  buyer: "BUY",
  client: "CLI"
} as const;

const enumSets = {
  saleRentFurnished: new Set(["furnished", "semi_furnished", "unfurnished", "unknown"]),
  clientRole: new Set(["owner", "seller", "landlord"])
};

const allowedFieldsByType: Record<ReviewType, string[]> = {
  sale: ["source", "price", "currency", "size_sqm", "bedrooms", "bathrooms", "area", "compound", "floor", "furnished", "finishing", "payment_terms", "notes"],
  rent: ["source", "price", "currency", "size_sqm", "bedrooms", "bathrooms", "area", "compound", "floor", "furnished", "finishing", "payment_terms", "notes"],
  buyer: ["source", "budget_min", "budget_max", "preferred_areas", "bedrooms_needed", "timeline", "notes"],
  client: ["source", "name", "phone", "role", "notes"]
};

const numericFields = new Set(["price", "size_sqm", "bedrooms", "bathrooms", "floor", "budget_min", "budget_max", "bedrooms_needed"]);

function text(value: unknown) {
  return String(value ?? "").trim();
}

function digitsOnly(value: unknown) {
  return text(value).replace(/\D/g, "");
}

function numericOrNull(value: unknown) {
  const raw = digitsOnly(value);
  return raw ? Number(raw) : null;
}

function normalizePhone(value: unknown) {
  return String(value ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
}

function parseStoragePathFromPublicUrl(url: string) {
  try {
    const u = new URL(url);
    const marker = "/object/public/crm-media/";
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return "";
    return decodeURIComponent(u.pathname.slice(idx + marker.length));
  } catch {
    return "";
  }
}

function computeMissingCritical(type: ReviewType, row: Record<string, unknown>) {
  if (type === "sale" || type === "rent") {
    const out: string[] = [];
    if (!row.price) out.push("price");
    if (!text(row.area) && !text(row.compound)) out.push("location_area");
    return out;
  }

  if (type === "buyer") {
    const out: string[] = [];
    if (!row.budget_min && !row.budget_max) out.push("budget");
    if (!Array.isArray(row.preferred_areas) || row.preferred_areas.length === 0) out.push("preferred_areas");
    return out;
  }

  const out: string[] = [];
  if (!text(row.name) && !text(row.phone)) out.push("name_or_phone");
  if (!text(row.role)) out.push("client_type");
  return out;
}

function sanitizeForType(type: ReviewType, input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const field of allowedFieldsByType[type]) {
    const value = input[field];
    if (numericFields.has(field)) {
      out[field] = numericOrNull(value);
      continue;
    }

    if (field === "preferred_areas") {
      out[field] = Array.isArray(value)
        ? value.map((v) => text(v)).filter(Boolean)
        : text(value)
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
      continue;
    }

    if (field === "phone") {
      out[field] = normalizePhone(value);
      continue;
    }

    if (field === "furnished") {
      const v = text(value).toLowerCase();
      out[field] = enumSets.saleRentFurnished.has(v) ? v : "unknown";
      continue;
    }

    if (field === "role") {
      const v = text(value).toLowerCase();
      out[field] = enumSets.clientRole.has(v) ? v : "owner";
      continue;
    }

    out[field] = text(value);
  }
  return out;
}

async function nextCode(prefix: string) {
  const supabase = createSupabaseClient();
  const year = new Date().getFullYear();

  const { data: existing } = await supabase
    .from("crm_code_sequences")
    .select("last_value")
    .eq("code_key", prefix)
    .eq("year_num", year)
    .maybeSingle();

  const next = Number(existing?.last_value || 0) + 1;

  const { error } = await supabase.from("crm_code_sequences").upsert(
    { code_key: prefix, year_num: year, last_value: next },
    { onConflict: "code_key,year_num" }
  );
  if (error) throw new Error(error.message);

  return `${prefix}-${year}-${String(next).padStart(5, "0")}`;
}

export async function createTimelineEvent(record_type: "properties_sale" | "properties_rent" | "buyers" | "clients", record_id: string, action: string, details: Record<string, unknown>) {
  const supabase = createSupabaseClient();
  const { error } = await supabase.from("timeline").insert({ record_type, record_id, action, details });
  if (error) throw new Error(error.message);
}

export async function moveMediaForSession(session_id: string, record_type: "properties_sale" | "properties_rent" | "buyers" | "clients", record_id: string) {
  const supabase = createSupabaseClient();
  const { data: mediaRows, error } = await supabase
    .from("media")
    .select("id, file_url, media_type")
    .eq("intake_session_id", session_id);
  if (error) throw new Error(error.message);

  const warnings: string[] = [];
  let images = 0;
  let videos = 0;
  let documents = 0;

  for (const row of mediaRows || []) {
    const sourcePath = parseStoragePathFromPublicUrl(String(row.file_url || ""));
    if (!sourcePath) {
      warnings.push(`Path parse failed for media ${row.id}`);
      continue;
    }

    const filename = sourcePath.split("/").pop() || `${row.id}`;
    const destinationPath = `media/${record_type}/${record_id}/${filename}`;

    const moveResult = await supabase.storage.from("crm-media").move(sourcePath, destinationPath);
    if (moveResult.error) {
      const copyResult = await supabase.storage.from("crm-media").copy(sourcePath, destinationPath);
      if (copyResult.error) {
        warnings.push(`Move/copy failed for media ${row.id}`);
      } else {
        warnings.push(`Move failed; copied instead for media ${row.id}`);
      }
    }

    const { data: urlData } = supabase.storage.from("crm-media").getPublicUrl(destinationPath);

    const { error: mediaUpdateError } = await supabase
      .from("media")
      .update({
        record_type,
        record_id,
        linked_record_type: record_type,
        linked_record_id: record_id,
        file_url: urlData.publicUrl
      })
      .eq("id", row.id);

    if (mediaUpdateError) warnings.push(`Media row update failed ${row.id}`);

    if (row.media_type === "image") images += 1;
    else if (row.media_type === "video") videos += 1;
    else documents += 1;
  }

  return { images, videos, documents, moveWarnings: warnings };
}

function mergeRow(existing: Record<string, unknown>, incoming: Record<string, unknown>, merge: Record<string, MergeMode>) {
  const out: Record<string, unknown> = {};
  const changed: string[] = [];

  for (const key of Object.keys(incoming)) {
    const decision = merge[key] || (key === "notes" ? "append" : "replace_with_new");
    const current = existing[key];
    const next = incoming[key];

    let value = current;
    if (decision === "replace_with_new") value = next;
    if (decision === "append" && key === "notes") {
      const left = text(current);
      const right = text(next);
      value = left && right ? `${left}\n${right}` : left || right;
    }

    out[key] = value;
    if (String(current ?? "") !== String(value ?? "")) changed.push(key);
  }

  return { row: out, changedFields: changed };
}

export async function confirmIntakeSession(session_id: string, mode: Mode, target_record_id?: string, input?: Omit<ConfirmInput, "session_id" | "mode" | "target_record_id">): Promise<ConfirmResult> {
  if (!input) throw new Error("confirm input is required");
  const supabase = createSupabaseClient();
  const recordType = tableByType[input.type];

  const { data: intake, error: intakeError } = await supabase
    .from("intake_sessions")
    .select("id, status, ai_meta")
    .eq("id", session_id)
    .single();

  if (intakeError || !intake) throw new Error(intakeError?.message || "Intake session not found");
  if (intake.status === "confirmed") throw new Error("Intake session already confirmed");

  const sanitized = sanitizeForType(input.type, input.extracted_data);
  const contactNameCandidate = sanitized.name || input.extracted_data.contact_name || input.extracted_data.name;
  const contactPhoneCandidate = sanitized.phone || input.extracted_data.contact_phone || input.extracted_data.phone;
  const contactId = await resolveContactId({ name: contactNameCandidate, phone: contactPhoneCandidate });
  const missingCritical = computeMissingCritical(input.type, sanitized);
  const rowStatus: "active" | "needs_review" = missingCritical.length > 0 ? "needs_review" : "active";

  let recordId = target_record_id || "";
  let changedFields: string[] = [];

  if (mode === "create_new") {
    const code = await nextCode(codePrefixByType[input.type]);
    const { data, error } = await supabase
      .from(recordType)
      .insert({ ...sanitized, contact_id: contactId, code, status: rowStatus, intake_session_id: session_id })
      .select("id")
      .single();

    if (error || !data) throw new Error(error?.message || "Create record failed");
    recordId = data.id;
    changedFields = Object.keys(sanitized);
    if (contactId) changedFields.push("contact_id");

    await createTimelineEvent(recordType, recordId, "Record created from intake", { session_id, type: input.type, row_status: rowStatus });
  } else {
    if (!target_record_id) throw new Error("target_record_id is required for update_existing");
    const { data: existing, error } = await supabase.from(recordType).select("*").eq("id", target_record_id).single();
    if (error || !existing) throw new Error(error?.message || "Target record not found");

    const merged = mergeRow(existing as Record<string, unknown>, sanitized, input.merge_decisions);
    changedFields = merged.changedFields;

    const mergedWithContact = { ...merged.row, ...(contactId ? { contact_id: contactId } : {}) };
    if (contactId && String(existing.contact_id || "") !== String(contactId)) changedFields.push("contact_id");

    const { error: updateError } = await supabase.from(recordType).update({ ...mergedWithContact, status: rowStatus }).eq("id", target_record_id);
    if (updateError) throw new Error(updateError.message);

    recordId = target_record_id;
    await createTimelineEvent(recordType, recordId, "Record updated from intake", { session_id, changed_fields: changedFields, row_status: rowStatus });
  }

  const mediaSummary = await moveMediaForSession(session_id, recordType, recordId);
  if (contactId) {
    await createTimelineEvent(recordType, recordId, "Linked to contact", { contact_id: contactId });
  }
  await createTimelineEvent(recordType, recordId, `Media attached: ${mediaSummary.images} images, ${mediaSummary.videos} videos, ${mediaSummary.documents} documents`, {
    session_id,
    ...mediaSummary,
    warning: mediaSummary.moveWarnings.length > 0
  });

  if (mediaSummary.moveWarnings.length > 0) {
    await createTimelineEvent(recordType, recordId, "Media move warning", { warnings: mediaSummary.moveWarnings });
  }

  const mergedMeta = {
    ...((intake.ai_meta || {}) as Record<string, unknown>),
    missing_critical_fields: missingCritical,
    final_row_status: rowStatus
  };

  const { error: intakeUpdateError } = await supabase
    .from("intake_sessions")
    .update({
      status: "confirmed",
      type_confirmed: input.type,
      final_record_type: recordType,
      final_record_id: recordId,
      ai_meta: mergedMeta
    })
    .eq("id", session_id);

  if (intakeUpdateError) throw new Error(intakeUpdateError.message);

  return { recordType, recordId, status: rowStatus, changedFields, mediaSummary };
}
