import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";

const configByType = {
  sale: { table: "properties_sale", select: "id, code, created_at, updated_at, source, notes" },
  rent: { table: "properties_rent", select: "id, code, created_at, updated_at, source, notes" },
  buyer: { table: "buyers", select: "id, code, created_at, updated_at, source, notes" },
  client: { table: "clients", select: "id, code, created_at, updated_at, source, name, phone" }
} as const;

export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as keyof typeof configByType | null;
  const q = (searchParams.get("q") || "").trim();

  if (!type || !(type in configByType)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const conf = configByType[type];
  let query = supabase.from(conf.table).select(conf.select).order("updated_at", { ascending: false }).limit(20);

  if (q) {
    if (type === "client") query = query.or(`code.ilike.%${q}%,source.ilike.%${q}%,name.ilike.%${q}%,phone.ilike.%${q}%`);
    else query = query.or(`code.ilike.%${q}%,source.ilike.%${q}%,notes.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const normalized = ((data || []) as unknown[]).map((row) => {
    const obj = (row || {}) as Record<string, unknown>;
    const fallback = [obj.name, obj.phone].filter(Boolean).join(" | ");
    return { ...obj, notes: obj.notes || fallback };
  });

  return NextResponse.json({ results: normalized });
}
