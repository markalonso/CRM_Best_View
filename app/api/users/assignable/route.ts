import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";

export async function GET() {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,name,role")
    .order("name", { ascending: true })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: (data || []).map((row) => ({ id: String(row.user_id), name: String(row.name || "User"), role: String(row.role || "viewer") })) });
}
