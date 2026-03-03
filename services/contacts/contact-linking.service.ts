import { createSupabaseClient } from "@/services/supabase/client";

function asText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeContactPhone(value: unknown) {
  return asText(value).replace(/\D/g, "");
}

export async function resolveContactId(input: { name?: unknown; phone?: unknown }) {
  const supabase = createSupabaseClient();
  const normalizedPhone = normalizeContactPhone(input.phone);
  const normalizedName = asText(input.name);

  if (normalizedPhone) {
    const { data: found } = await supabase
      .from("contacts")
      .select("id")
      .eq("phone", normalizedPhone)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (found?.id) return String(found.id);

    const { data: created, error } = await supabase
      .from("contacts")
      .insert({ name: normalizedName || "Unknown", phone: normalizedPhone })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "Failed to create contact");
    return String(created.id);
  }

  if (normalizedName) {
    const { data: created, error } = await supabase
      .from("contacts")
      .insert({ name: normalizedName, phone: null })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "Failed to create contact");
    return String(created.id);
  }

  return null;
}
