import "server-only";
import { createSupabaseClient } from "@/services/supabase/client";
import { resolveContactId } from "@/services/contacts/contact-linking.service";
import {
  assignMediaToHierarchyNode,
  assignRecordToHierarchyNode,
  assertValidRecordHierarchyDestination,
  createOrReuseIntakeMediaChildNode,
  fetchEffectiveFieldDefinitions,
  reviewTypeToHierarchyFamily,
  saveCustomFieldValuesForRecord
} from "@/services/hierarchy/hierarchy.service";
import type { EffectiveFieldDefinition } from "@/types/hierarchy";

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
  hierarchy_node_id?: string;
  media_folder_name?: string;
  custom_field_values?: Array<{ fieldKey: string; value: unknown }>;
  actor_user_id?: string | null;
};

type ConfirmResult = {
  recordType: string;
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
    const markers = ["/object/public/crm-media/", "/object/public/media/"];

    for (const marker of markers) {
      const idx = u.pathname.indexOf(marker);
      if (idx !== -1) {
        return decodeURIComponent(u.pathname.slice(idx + marker.length));
      }
    }

    return "";
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

async function resolveAllowedCoreFields(type: ReviewType, hierarchyNodeId?: string) {
  const hierarchyFamily = reviewTypeToHierarchyFamily(type);
  const dynamicFields = hierarchyFamily
    ? await fetchEffectiveFieldDefinitions({
        family: hierarchyFamily,
        nodeId: hierarchyNodeId || undefined
      }).catch(() => [] as EffectiveFieldDefinition[])
    : [];

  const dynamicCoreFields = dynamicFields.filter((field) => field.storage_kind === "core_column");
  const dynamicCoreByColumn = new Map(
    dynamicCoreFields.map((field) => [field.core_column_name || field.field_key, field])
  );

  allowedFieldsByType[type].forEach((fieldKey) => {
    if (!dynamicCoreByColumn.has(fieldKey)) {
      dynamicCoreByColumn.set(fieldKey, {
        id: fieldKey,
        family: hierarchyFamily || "sale",
        field_key: fieldKey,
        default_label: fieldKey,
        description: null,
        data_type: numericFields.has(fieldKey) ? "number" : fieldKey === "preferred_areas" ? "multi_select" : "text",
        storage_kind: "core_column",
        core_column_name: fieldKey,
        is_system: true,
        is_active: true,
        is_visible_default: true,
        is_required_default: false,
        is_filterable_default: false,
        is_sortable_default: false,
        is_grid_visible_default: false,
        is_intake_visible_default: true,
        is_detail_visible_default: true,
        display_order_default: 0,
        options_json: {},
        validation_json: {},
        created_by: null,
        created_at: "",
        updated_at: "",
        effective_label: fieldKey,
        effective_visible: true,
        effective_required: false,
        effective_filterable: false,
        effective_sortable: false,
        effective_grid_visible: false,
        effective_intake_visible: true,
        effective_detail_visible: true,
        effective_display_order: 0,
        effective_width_px: null,
        effective_options_json: {},
        effective_validation_json: {},
        override_source_node_id: null
      });
    }
  });

  return Array.from(dynamicCoreByColumn.values());
}

function sanitizeFieldValue(fieldKey: string, inputValue: unknown, field?: EffectiveFieldDefinition) {
  if (numericFields.has(fieldKey)) {
    return numericOrNull(inputValue);
  }

  if (fieldKey === "preferred_areas") {
    return Array.isArray(inputValue)
      ? inputValue.map((v) => text(v)).filter(Boolean)
      : text(inputValue)
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
  }

  if (fieldKey === "phone") {
    return normalizePhone(inputValue);
  }

  if (fieldKey === "furnished") {
    const v = text(inputValue).toLowerCase();
    return enumSets.saleRentFurnished.has(v) ? v : "unknown";
  }

  if (fieldKey === "role") {
    const v = text(inputValue).toLowerCase();
    return enumSets.clientRole.has(v) ? v : "owner";
  }

  if (field?.data_type === "boolean") {
    const normalized = text(inputValue).toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }

  return text(inputValue);
}

async function sanitizeForType(type: ReviewType, input: Record<string, unknown>, hierarchyNodeId?: string) {
  const allowedCoreFields = await resolveAllowedCoreFields(type, hierarchyNodeId);
  const out: Record<string, unknown> = {};
  for (const field of allowedCoreFields) {
    const targetKey = field.core_column_name || field.field_key;
    const inputValue = input[targetKey] ?? input[field.field_key];
    out[targetKey] = sanitizeFieldValue(targetKey, inputValue, field);
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

export async function createTimelineEvent(record_type: string, record_id: string, action: string, details: Record<string, unknown>) {
  const supabase = createSupabaseClient();
  const { error } = await supabase.from("timeline").insert({ record_type, record_id, action, details });
  if (error) throw new Error(error.message);
}

export async function moveMediaForSession(session_id: string, record_type: string, record_id: string) {
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
    if (row.media_type === "image") images += 1;
    else if (row.media_type === "video") videos += 1;
    else documents += 1;

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
        continue;
      }
      warnings.push(`Move failed; copied instead for media ${row.id}`);
    }

    const { data: urlData } = supabase.storage.from("crm-media").getPublicUrl(destinationPath);
    const { error: mediaUrlUpdateError } = await supabase
      .from("media")
      .update({ file_url: urlData.publicUrl })
      .eq("id", row.id);

    if (mediaUrlUpdateError) warnings.push(`Media URL update failed ${row.id}: ${mediaUrlUpdateError.message}`);
  }


  return { images, videos, documents, moveWarnings: warnings };
}


async function linkMediaRowsToRecord(session_id: string, record_type: string, record_id: string) {
  const supabase = createSupabaseClient();

  const { count: rowsBeforeUpdate, error: beforeCountError } = await supabase
    .from("media")
    .select("id", { count: "exact", head: true })
    .eq("intake_session_id", session_id);

  const mediaRowsBeforeUpdate = rowsBeforeUpdate || 0;
  if (beforeCountError) {
    console.error("[confirm-intake] media count before linkage failed", {
      intake_session_id: session_id,
      final_record_type: record_type,
      final_record_id: record_id,
      update_error: beforeCountError.message
    });
  }

  console.info("[confirm-intake] linking media rows", {
    intake_session_id: session_id,
    final_record_type: record_type,
    final_record_id: record_id,
    media_rows_before_update: mediaRowsBeforeUpdate
  });

  const { data: linkedRows, error } = await supabase
    .from("media")
    .update({
      record_type,
      record_id
    })
    .eq("intake_session_id", session_id)
    .select("id");

  const mediaRowsUpdated = linkedRows?.length || 0;

  if (error) {
    console.error("[confirm-intake] media linkage update failed", {
      intake_session_id: session_id,
      final_record_type: record_type,
      final_record_id: record_id,
      media_rows_before_update: mediaRowsBeforeUpdate,
      media_rows_updated: mediaRowsUpdated,
      update_error: error.message
    });
    throw new Error(error.message);
  }

  console.info("[confirm-intake] media linkage update complete", {
    intake_session_id: session_id,
    final_record_type: record_type,
    final_record_id: record_id,
    media_rows_before_update: mediaRowsBeforeUpdate,
    media_rows_updated: mediaRowsUpdated,
    update_error: null
  });

  return mediaRowsUpdated;
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

  const sanitized = await sanitizeForType(input.type, input.extracted_data, input.hierarchy_node_id);
  const contactNameCandidate = sanitized.name || input.extracted_data.contact_name || input.extracted_data.name;
  const contactPhoneCandidate = sanitized.phone || input.extracted_data.contact_phone || input.extracted_data.phone;
  const contactId = await resolveContactId({ name: contactNameCandidate, phone: contactPhoneCandidate });
  const missingCritical = computeMissingCritical(input.type, sanitized);
  const rowStatus: "active" | "needs_review" = missingCritical.length > 0 ? "needs_review" : "active";
  const hierarchyFamily = reviewTypeToHierarchyFamily(input.type);
  const { count: sessionMediaCount, error: mediaCountError } = await supabase
    .from("media")
    .select("id", { count: "exact", head: true })
    .eq("intake_session_id", session_id);

  if (mediaCountError) throw new Error(mediaCountError.message);
  const hasSessionMedia = (sessionMediaCount || 0) > 0;
  const mediaFolderName = String(input.media_folder_name || "").trim();

  if (input.hierarchy_node_id) {
    await assertValidRecordHierarchyDestination({
      family: hierarchyFamily,
      nodeId: input.hierarchy_node_id
    });
  }
  if (hasSessionMedia && !mediaFolderName) {
    throw new Error("Media folder name is required when intake contains media.");
  }

  let mediaHierarchyNodeId: string | null = null;
  let mediaHierarchyNodeName: string | null = null;
  if (hasSessionMedia && input.hierarchy_node_id) {
    const mediaChildNode = await createOrReuseIntakeMediaChildNode({
      family: hierarchyFamily,
      parentNodeId: input.hierarchy_node_id,
      intakeSessionId: session_id,
      folderName: mediaFolderName,
      actorUserId: input.actor_user_id || null
    });
    mediaHierarchyNodeId = mediaChildNode.id;
    mediaHierarchyNodeName = mediaChildNode.name;
  }

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

  let linkedMediaCount = 0;
  try {
    linkedMediaCount = await linkMediaRowsToRecord(session_id, recordType, recordId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown media linkage update error";
    console.error("[confirm-intake] media linkage update failed after record creation", {
      intake_session_id: session_id,
      final_record_type: recordType,
      final_record_id: recordId,
      error: message
    });
  }

  let mediaSummary: { images: number; videos: number; documents: number; moveWarnings: string[] } = {
    images: 0,
    videos: 0,
    documents: 0,
    moveWarnings: []
  };

  try {
    mediaSummary = await moveMediaForSession(session_id, recordType, recordId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown media linkage error";
    console.error("[confirm-intake] media linkage failed after record creation", {
      session_id,
      recordType,
      recordId,
      error: message
    });
    mediaSummary.moveWarnings.push(`Media linkage failed after record creation: ${message}`);
  }
  if (contactId) {
    await createTimelineEvent(recordType, recordId, "Linked to contact", { contact_id: contactId });
  }
  await createTimelineEvent(recordType, recordId, `Media attached: ${mediaSummary.images} images, ${mediaSummary.videos} videos, ${mediaSummary.documents} documents`, {
    session_id,
    linked_media_rows: linkedMediaCount,
    ...mediaSummary,
    warning: mediaSummary.moveWarnings.length > 0
  });

  if (mediaSummary.moveWarnings.length > 0) {
    await createTimelineEvent(recordType, recordId, "Media move warning", { warnings: mediaSummary.moveWarnings });
  }

  if (input.hierarchy_node_id) {
    await assignRecordToHierarchyNode({
      family: hierarchyFamily,
      recordId,
      nodeId: input.hierarchy_node_id,
      actorUserId: input.actor_user_id || null
    });

    const { data: mediaRows } = await supabase
      .from("media")
      .select("id")
      .eq("record_type", recordType)
      .eq("record_id", recordId);

    if (mediaHierarchyNodeId) {
      await createTimelineEvent(recordType, recordId, "Created media hierarchy folder", {
        parent_hierarchy_node_id: input.hierarchy_node_id,
        media_hierarchy_node_id: mediaHierarchyNodeId,
        media_folder_name: mediaHierarchyNodeName || mediaFolderName
      });
    }

    for (const mediaRow of mediaRows || []) {
      await assignMediaToHierarchyNode({
        mediaId: String(mediaRow.id),
        nodeId: mediaHierarchyNodeId || input.hierarchy_node_id,
        actorUserId: input.actor_user_id || null
      });
    }

    await createTimelineEvent(recordType, recordId, "Assigned hierarchy node", {
      hierarchy_node_id: input.hierarchy_node_id,
      media_hierarchy_node_id: mediaHierarchyNodeId
    });
  }

  if ((input.custom_field_values || []).length > 0) {
    const savedCustomValues = await saveCustomFieldValuesForRecord({
      family: hierarchyFamily,
      recordId,
      values: input.custom_field_values || [],
      actorUserId: input.actor_user_id || null
    });

    if (savedCustomValues.length > 0) {
      await createTimelineEvent(recordType, recordId, "Saved custom field values", {
        custom_field_count: savedCustomValues.length
      });
    }
  }

  const mergedMeta = {
    ...((intake.ai_meta || {}) as Record<string, unknown>),
    missing_critical_fields: missingCritical,
    final_row_status: rowStatus,
    hierarchy_node_id: input.hierarchy_node_id || null,
    media_folder_name: hasSessionMedia ? mediaFolderName : null,
    media_hierarchy_node_id: mediaHierarchyNodeId
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
