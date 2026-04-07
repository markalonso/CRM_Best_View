import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { getRequestActor, requireAdminActor } from "@/services/auth/role.service";
import { createTimelineEvent } from "@/services/intake/confirm-intake.service";
import { normalizeContactPhone } from "@/services/contacts/contact-linking.service";
import { fetchCustomFieldValuesForRecords, fetchEffectiveFieldDefinitions } from "@/services/hierarchy/hierarchy.service";

type GridType = "sale" | "rent" | "buyer" | "client";

const map = {
  sale: { table: "properties_sale" },
  rent: { table: "properties_rent" },
  buyer: { table: "buyers" },
  client: { table: "clients" }
} as const;

const relatedTypeMap: Record<GridType, "sale" | "rent" | "buyer" | "client"> = {
  sale: "sale",
  rent: "rent",
  buyer: "buyer",
  client: "client"
};


const hierarchyFamilyByType: Record<GridType, "sale" | "rent" | "buyers" | "clients"> = {
  sale: "sale",
  rent: "rent",
  buyer: "buyers",
  client: "clients"
};

const recordLinkColumnByType: Record<GridType, "sale_id" | "rent_id" | "buyer_id" | "client_id"> = {
  sale: "sale_id",
  rent: "rent_id",
  buyer: "buyer_id",
  client: "client_id"
};

async function resolveEffectiveNodeId(supabase: ReturnType<typeof createSupabaseClient>, type: GridType, recordId: string, requestedNodeId?: string) {
  const directNodeId = String(requestedNodeId || "").trim();
  if (directNodeId) return directNodeId;

  const linkColumn = recordLinkColumnByType[type];
  const { data: link } = await supabase
    .from("record_hierarchy_links")
    .select("node_id")
    .eq(linkColumn, recordId)
    .maybeSingle();

  return String(link?.node_id || "");
}

export async function GET(request: NextRequest) {
  const actor = await getRequestActor(request);
  if (!actor.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createSupabaseClient();
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get("type") || "sale") as GridType;
  const id = searchParams.get("id") || "";

  if (!map[type] || !id) return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  if (actor.role === "agent" && type !== "sale" && type !== "rent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const hierarchyNodeId = await resolveEffectiveNodeId(supabase, type, id, searchParams.get("nodeId") || "");

  const { data: record, error } = await supabase.from(map[type].table).select("*").eq("id", id).single();
  if (error || !record) return NextResponse.json({ error: error?.message || "Record not found" }, { status: 404 });

  const contactId = String((record as { contact_id?: string | null }).contact_id || "");
  const { data: linkedContact } = contactId ? await supabase.from("contacts").select("id,name,phone,created_at,updated_at").eq("id", contactId).maybeSingle() : { data: null };

  const { data: media } = await supabase
    .from("media")
    .select("id, file_url, media_type, created_at")
    .eq("record_id", id)
    .eq("record_type", map[type].table)
    .order("created_at", { ascending: false });

  const { data: timeline } = await supabase
    .from("timeline")
    .select("id, action, details, created_at")
    .eq("record_id", id)
    .eq("record_type", map[type].table)
    .order("created_at", { ascending: false })
    .limit(30);

  let linked_records: Array<Record<string, unknown>> = [];
  if (type === "client") {
    const { data: saleLinks } = await supabase.from("properties_sale").select("id, code, status, price, area, updated_at").eq("client_id", id).order("updated_at", { ascending: false }).limit(20);
    const { data: rentLinks } = await supabase.from("properties_rent").select("id, code, status, price, area, updated_at").eq("client_id", id).order("updated_at", { ascending: false }).limit(20);
    linked_records = [
      ...(saleLinks || []).map((x) => ({ ...x, record_type: "properties_sale" })),
      ...(rentLinks || []).map((x) => ({ ...x, record_type: "properties_rent" }))
    ];
  }



  const { data: auditLogs } = await supabase
    .from("audit_logs")
    .select("id, user_id, action, source, before_json, after_json, created_at")
    .eq("record_type", map[type].table)
    .eq("record_id", id)
    .order("created_at", { ascending: false })
    .limit(30);

  const userIds = Array.from(new Set((auditLogs || []).map((x) => String(x.user_id || "")).filter(Boolean)));
  const { data: profiles } = userIds.length ? await supabase.from("profiles").select("user_id,name").in("user_id", userIds) : { data: [] };
  const nameByUser = new Map<string, string>((profiles || []).map((x) => [String(x.user_id), String(x.name || "User")]));

  const enrichedAudit = (auditLogs || []).map((row) => ({ ...row, actor_name: nameByUser.get(String(row.user_id || "")) || "System" }));
  const lastEdited = enrichedAudit[0] ? { by: enrichedAudit[0].actor_name, at: enrichedAudit[0].created_at } : null;

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, related_type, related_id, title, due_date, status, assigned_to, created_by, created_at")
    .eq("related_type", relatedTypeMap[type])
    .eq("related_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: contactTasks } = linkedContact?.id
    ? await supabase
        .from("tasks")
        .select("id, related_type, related_id, title, due_date, status, assigned_to, created_by, created_at")
        .eq("related_type", "contact")
        .eq("related_id", String(linkedContact.id))
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [] };

  const taskUserIds = Array.from(
    new Set(
      [
        ...(tasks || []),
        ...(contactTasks || [])
      ]
        .flatMap((task) => [String(task.assigned_to || ""), String(task.created_by || "")])
        .filter(Boolean)
    )
  );
  const { data: taskProfiles } = taskUserIds.length
    ? await supabase.from("profiles").select("user_id,name,role").in("user_id", taskUserIds)
    : { data: [] };
  const taskByUser = new Map<string, { name: string; role: string }>((taskProfiles || []).map((x) => [String(x.user_id), { name: String(x.name || "User"), role: String(x.role || "viewer") }]));

  const enrichTask = (task: Record<string, unknown>) => ({
    ...task,
    assigned_to_name: task.assigned_to ? taskByUser.get(String(task.assigned_to))?.name || "User" : null,
    created_by_name: task.created_by ? taskByUser.get(String(task.created_by))?.name || "User" : null
  });

  const { data: assignees } = await supabase
    .from("profiles")
    .select("user_id,name,role")
    .order("name", { ascending: true })
    .limit(200);

  const effectiveFields = await fetchEffectiveFieldDefinitions({
    family: hierarchyFamilyByType[type],
    nodeId: hierarchyNodeId || undefined
  });
  const customValuesByRecordId = await fetchCustomFieldValuesForRecords({
    family: hierarchyFamilyByType[type],
    recordIds: [id],
    fieldDefinitionIds: effectiveFields.filter((field) => field.storage_kind === "custom_value").map((field) => field.id)
  });
  const customFieldById = new Map(effectiveFields.filter((field) => field.storage_kind === "custom_value").map((field) => [field.id, field.field_key]));
  const rawCustomValues = customValuesByRecordId[id] || {};
  const field_values: Record<string, unknown> = {};

  effectiveFields.forEach((field) => {
    if (field.storage_kind === "core_column") {
      const sourceKey = field.core_column_name || field.field_key;
      field_values[field.field_key] = (record as Record<string, unknown>)[sourceKey];
      return;
    }

    Object.entries(rawCustomValues).forEach(([fieldDefinitionId, value]) => {
      if (customFieldById.get(fieldDefinitionId) === field.field_key) field_values[field.field_key] = value;
    });
  });

  return NextResponse.json({
    record,
    fields: effectiveFields,
    field_values,
    linked_contact: linkedContact || null,
    linked_records,
    media: media || [],
    timeline: timeline || [],
    audit_logs: enrichedAudit,
    last_edited: lastEdited,
    tasks: (tasks || []).map((t) => enrichTask(t as Record<string, unknown>)),
    contact_tasks: (contactTasks || []).map((t) => enrichTask(t as Record<string, unknown>)),
    assignees: (assignees || []).map((x) => ({ id: String(x.user_id), name: String(x.name || "User"), role: String(x.role || "viewer") }))
  });
}

type PatchBody = {
  type: GridType;
  id: string;
  action: "link_existing_contact" | "create_contact";
  contact_id?: string;
  name?: string;
  phone?: string;
};

export async function PATCH(request: NextRequest) {
  const { errorResponse } = await requireAdminActor(request);
  if (errorResponse) return errorResponse;

  const body = (await request.json()) as PatchBody;
  if (!map[body.type] || !body.id || !body.action) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  const supabase = createSupabaseClient();
  const { data: recordState, error: recordStateError } = await supabase
    .from(map[body.type].table)
    .select("id,is_archived")
    .eq("id", body.id)
    .maybeSingle();
  if (recordStateError) return NextResponse.json({ error: recordStateError.message }, { status: 500 });
  if (!recordState) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  if (recordState.is_archived) {
    return NextResponse.json({ error: "Archived records are read-only. Unarchive first." }, { status: 409 });
  }

  let contactId = "";

  if (body.action === "link_existing_contact") {
    contactId = String(body.contact_id || "").trim();
    if (!contactId) return NextResponse.json({ error: "contact_id required" }, { status: 400 });
  } else {
    const name = String(body.name || "").trim();
    const phone = normalizeContactPhone(body.phone);
    if (!name && !phone) return NextResponse.json({ error: "name or phone is required" }, { status: 400 });

    const { data: existing } = phone ? await supabase.from("contacts").select("id").eq("phone", phone).maybeSingle() : { data: null };
    if (existing?.id) {
      contactId = String(existing.id);
    } else {
      const { data: created, error: createError } = await supabase
        .from("contacts")
        .insert({ name: name || "Unknown", phone: phone || null })
        .select("id")
        .single();
      if (createError || !created) return NextResponse.json({ error: createError?.message || "Failed to create contact" }, { status: 500 });
      contactId = String(created.id);
    }
  }

  const { error: linkError } = await supabase.from(map[body.type].table).update({ contact_id: contactId }).eq("id", body.id);
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });

  await createTimelineEvent(map[body.type].table, body.id, "Linked to contact", { contact_id: contactId, source: "drawer" });

  const { data: linkedContact } = await supabase.from("contacts").select("id,name,phone,created_at,updated_at").eq("id", contactId).single();

  return NextResponse.json({ ok: true, linked_contact: linkedContact });
}
