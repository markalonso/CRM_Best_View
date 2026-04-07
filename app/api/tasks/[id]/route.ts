import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { requireAdminActor } from "@/services/auth/role.service";

type RelatedType = "sale" | "rent" | "buyer" | "client" | "contact";

const relatedToRecordType: Record<RelatedType, "properties_sale" | "properties_rent" | "buyers" | "clients" | "contacts"> = {
  sale: "properties_sale",
  rent: "properties_rent",
  buyer: "buyers",
  client: "clients",
  contact: "contacts"
};

async function isContactLinkedToArchivedRecords(supabase: ReturnType<typeof createSupabaseClient>, contactId: string) {
  const [sale, rent, buyers, clients] = await Promise.all([
    supabase.from("properties_sale").select("id", { count: "exact", head: true }).eq("contact_id", contactId).eq("is_archived", true),
    supabase.from("properties_rent").select("id", { count: "exact", head: true }).eq("contact_id", contactId).eq("is_archived", true),
    supabase.from("buyers").select("id", { count: "exact", head: true }).eq("contact_id", contactId).eq("is_archived", true),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("contact_id", contactId).eq("is_archived", true)
  ]);

  if (sale.error) throw new Error(sale.error.message);
  if (rent.error) throw new Error(rent.error.message);
  if (buyers.error) throw new Error(buyers.error.message);
  if (clients.error) throw new Error(clients.error.message);

  return (sale.count || 0) + (rent.count || 0) + (buyers.count || 0) + (clients.count || 0) > 0;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { errorResponse } = await requireAdminActor(request);
  if (errorResponse) return errorResponse;

  const body = (await request.json()) as { status?: "open" | "done" | "cancelled"; due_date?: string | null; assigned_to?: string | null; title?: string };
  const updates: Record<string, unknown> = {};

  if (body.status) updates.status = body.status;
  if (Object.prototype.hasOwnProperty.call(body, "due_date")) updates.due_date = body.due_date || null;
  if (Object.prototype.hasOwnProperty.call(body, "assigned_to")) updates.assigned_to = body.assigned_to || null;
  if (typeof body.title === "string") updates.title = body.title.trim();

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No updates provided" }, { status: 400 });

  const supabase = createSupabaseClient();
  const { data: before } = await supabase.from("tasks").select("id,related_type,related_id,status,title,due_date,assigned_to").eq("id", params.id).maybeSingle();
  if (!before) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const relatedTypeBefore = String(before.related_type || "") as RelatedType;
  if (relatedTypeBefore !== "contact") {
    const relatedRecordTable = relatedToRecordType[relatedTypeBefore];
    const { data: recordState, error: recordStateError } = await supabase
      .from(relatedRecordTable)
      .select("id,is_archived")
      .eq("id", String(before.related_id))
      .maybeSingle();
    if (recordStateError) return NextResponse.json({ error: recordStateError.message }, { status: 500 });
    if (!recordState) return NextResponse.json({ error: "Related record not found" }, { status: 404 });
    if (recordState.is_archived) {
      return NextResponse.json({ error: "Cannot mutate tasks for archived records. Unarchive first." }, { status: 409 });
    }
  } else {
    const contactLinkedToArchived = await isContactLinkedToArchivedRecords(supabase, String(before.related_id));
    if (contactLinkedToArchived) {
      return NextResponse.json({ error: "Cannot mutate contact tasks while this contact is linked to archived records. Unarchive those records first." }, { status: 409 });
    }
  }

  const { data, error } = await supabase.from("tasks").update(updates).eq("id", params.id).select("id,related_type,related_id,status,title,due_date,assigned_to,created_by,created_at").single();
  if (error || !data) return NextResponse.json({ error: error?.message || "Failed to update task" }, { status: 500 });

  const relatedType = String(data.related_type || "") as RelatedType;
  if (body.status === "done") {
    await supabase.from("timeline").insert({
      record_type: relatedToRecordType[relatedType],
      record_id: String(data.related_id),
      action: "Task done",
      details: { task_id: data.id, title: data.title }
    });
  }

  return NextResponse.json({ task: data, before });
}
