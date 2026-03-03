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

export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient();
  const actor = await getRequestActor(request);
  const { searchParams } = new URL(request.url);

  const view = (searchParams.get("view") || "my") as "my" | "overdue" | "today" | "week" | "all";
  const relatedType = (searchParams.get("related_type") || "") as RelatedType | "";
  const relatedId = (searchParams.get("related_id") || "").trim();

  let query = supabase
    .from("tasks")
    .select("id, related_type, related_id, title, due_date, status, assigned_to, created_by, created_at")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(300);

  if (relatedType) query = query.eq("related_type", relatedType);
  if (relatedId) query = query.eq("related_id", relatedId);

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  if (view === "my" && actor.userId) {
    query = query.eq("assigned_to", actor.userId).neq("status", "done");
  }
  if (view === "my" && !actor.userId) {
    return NextResponse.json({ tasks: [] });
  }
  if (view === "overdue") {
    query = query.lt("due_date", now.toISOString()).eq("status", "open");
  }
  if (view === "today") {
    query = query.gte("due_date", startOfToday.toISOString()).lt("due_date", endOfToday.toISOString()).neq("status", "done");
  }
  if (view === "week") {
    query = query.gte("due_date", startOfToday.toISOString()).lt("due_date", endOfWeek.toISOString()).neq("status", "done");
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = Array.from(new Set((data || []).flatMap((row) => [String(row.assigned_to || ""), String(row.created_by || "")]).filter(Boolean)));
  const { data: profiles } = userIds.length ? await supabase.from("profiles").select("user_id,name,role").in("user_id", userIds) : { data: [] };
  const byUser = new Map<string, { name: string; role: string }>((profiles || []).map((p) => [String(p.user_id), { name: String(p.name || "User"), role: String(p.role || "viewer") }]));

  return NextResponse.json({
    tasks: (data || []).map((row) => ({
      ...row,
      assigned_to_name: row.assigned_to ? byUser.get(String(row.assigned_to))?.name || "User" : null,
      created_by_name: row.created_by ? byUser.get(String(row.created_by))?.name || "User" : null
    }))
  });
}

export async function POST(request: NextRequest) {
  const actor = await getRequestActor(request);
  if (!hasRole(actor.role, "agent")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json()) as {
    related_type?: RelatedType;
    related_id?: string;
    title?: string;
    due_date?: string | null;
    assigned_to?: string | null;
  };

  const relatedType = body.related_type;
  const relatedId = String(body.related_id || "").trim();
  const title = String(body.title || "").trim();
  if (!relatedType || !relatedToRecordType[relatedType] || !relatedId || !title) {
    return NextResponse.json({ error: "related_type, related_id, and title are required" }, { status: 400 });
  }

  const supabase = createSupabaseClient();
  const payload = {
    related_type: relatedType,
    related_id: relatedId,
    title,
    due_date: body.due_date || null,
    assigned_to: body.assigned_to || actor.userId,
    created_by: actor.userId
  };

  const { data, error } = await supabase
    .from("tasks")
    .insert(payload)
    .select("id, related_type, related_id, title, due_date, status, assigned_to, created_by, created_at")
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Failed to create task" }, { status: 500 });

  await supabase.from("timeline").insert({
    record_type: relatedToRecordType[relatedType],
    record_id: relatedId,
    action: "Task added",
    details: { task_id: data.id, title, assigned_to: data.assigned_to, due_date: data.due_date }
  });

  return NextResponse.json({ task: data });
}
