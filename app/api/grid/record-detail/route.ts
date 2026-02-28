import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";

type GridType = "sale" | "rent" | "buyer" | "client";

const map = {
  sale: { table: "properties_sale" },
  rent: { table: "properties_rent" },
  buyer: { table: "buyers" },
  client: { table: "clients" }
} as const;

export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient();
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get("type") || "sale") as GridType;
  const id = searchParams.get("id") || "";

  if (!map[type] || !id) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  const { data: record, error } = await supabase.from(map[type].table).select("*").eq("id", id).single();
  if (error || !record) return NextResponse.json({ error: error?.message || "Record not found" }, { status: 404 });

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


  return NextResponse.json({ record, linked_records, media: media || [], timeline: timeline || [], audit_logs: enrichedAudit, last_edited: lastEdited });
}
