import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { createTimelineEvent } from "@/services/intake/confirm-intake.service";
import { normalizeContactPhone } from "@/services/contacts/contact-linking.service";

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

export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient();
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get("type") || "sale") as GridType;
  const id = searchParams.get("id") || "";

  if (!map[type] || !id) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

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

  return NextResponse.json({
    record,
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
  const actor = await getRequestActor(request);
  if (!hasRole(actor.role, "agent")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json()) as PatchBody;
  if (!map[body.type] || !body.id || !body.action) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  const supabase = createSupabaseClient();
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
