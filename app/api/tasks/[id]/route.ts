import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { getRequestActor, hasRole } from "@/services/auth/role.service";

type RelatedType = "sale" | "rent" | "buyer" | "client" | "contact";

const relatedToRecordType: Record<RelatedType, "properties_sale" | "properties_rent" | "buyers" | "clients" | "contacts"> = {
  sale: "properties_sale",
  rent: "properties_rent",
  buyer: "buyers",
  client: "clients",
  contact: "contacts"
};

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getRequestActor(request);
  if (!hasRole(actor.role, "agent")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
