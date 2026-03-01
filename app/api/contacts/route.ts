import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { normalizeContactPhone } from "@/services/contacts/contact-linking.service";

export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient();
  const q = (new URL(request.url).searchParams.get("q") || "").trim();

  let query = supabase.from("contacts").select("id,name,phone,created_at,updated_at").order("updated_at", { ascending: false }).limit(20);
  if (q) {
    const digits = normalizeContactPhone(q);
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${digits || q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data || [] });
}

export async function POST(request: NextRequest) {
  const actor = await getRequestActor(request);
  if (!hasRole(actor.role, "agent")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json()) as { name?: string; phone?: string };
  const name = String(body.name || "").trim();
  const phone = normalizeContactPhone(body.phone);

  if (!name && !phone) return NextResponse.json({ error: "name or phone is required" }, { status: 400 });

  const supabase = createSupabaseClient();

  if (phone) {
    const { data: existing } = await supabase.from("contacts").select("id,name,phone").eq("phone", phone).maybeSingle();
    if (existing) return NextResponse.json({ contact: existing, existing: true });
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({ name: name || "Unknown", phone: phone || null })
    .select("id,name,phone,created_at,updated_at")
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Failed to create contact" }, { status: 500 });
  return NextResponse.json({ contact: data });
}
