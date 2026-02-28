import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { writeAuditLog } from "@/services/audit/audit-log.service";

type GridType = "sale" | "rent" | "buyer" | "client";

type Range = { min?: string; max?: string };
type GridFilters = {
  search?: string;
  price?: Range;
  currency?: string;
  size?: Range;
  bedrooms?: Range;
  bathrooms?: Range;
  areas?: string[];
  compounds?: string[];
  floor?: Range;
  furnished?: string;
  finishing?: string;
  payment_terms?: string;
  status?: string;
  has_media?: "yes" | "no";
  min_media_count?: string;
  created_from?: string;
  created_to?: string;
  updated_from?: string;
  updated_to?: string;
  source?: string;
  completeness?: Range;
  preset?: string;

  // buyer filters
  budget?: Range;
  intent?: string;
  preferred_areas?: string[];
  property_type?: string;
  bedrooms_needed_min?: string;
  move_timeline?: string;
  last_contact_from?: string;
  last_contact_to?: string;
  requirements_missing?: "yes" | "no";

  // client filters
  client_type?: string;
  city_area?: string;
  has_active_listings?: "yes" | "no";
  phone_exists?: "yes" | "no";
  tags?: string[];
};

type GridTable = "properties_sale" | "properties_rent" | "buyers" | "clients" | "contacts" | "intake_sessions";
type MapEntry = { table: GridTable; select: string };

const map: Record<string, MapEntry> = {
  sale: {
    table: "properties_sale",
    select: "id, code, status, source, price, currency, size_sqm, bedrooms, bathrooms, area, compound, floor, furnished, finishing, payment_terms, notes, completeness_score, created_at, updated_at"
  },
  rent: {
    table: "properties_rent",
    select: "id, code, status, source, price, currency, size_sqm, bedrooms, bathrooms, area, compound, floor, furnished, finishing, payment_terms, notes, completeness_score, created_at, updated_at"
  },
  buyer: {
    table: "buyers",
    select: "id, code, status, source, phone, currency, intent, property_type, budget_min, budget_max, preferred_areas, bedrooms_needed, timeline, last_contact_at, notes, completeness_score, created_at, updated_at"
  },
  client: {
    table: "clients",
    select: "id, code, status, source, name, phone, role, area, tags, completeness_score, created_at, updated_at"
  }
};

const editableByType: Record<GridType, Set<string>> = {
  sale: new Set(["source", "price", "currency", "size_sqm", "bedrooms", "bathrooms", "area", "compound", "floor", "furnished", "finishing", "payment_terms", "notes", "status"]),
  rent: new Set(["source", "price", "currency", "size_sqm", "bedrooms", "bathrooms", "area", "compound", "floor", "furnished", "finishing", "payment_terms", "notes", "status"]),
  buyer: new Set(["source", "phone", "currency", "intent", "property_type", "budget_min", "budget_max", "preferred_areas", "bedrooms_needed", "timeline", "last_contact_at", "notes", "status"]),
  client: new Set(["source", "name", "phone", "role", "area", "tags", "status"])
};

const numericFields = new Set(["price", "size_sqm", "bedrooms", "bathrooms", "floor", "budget_min", "budget_max", "bedrooms_needed"]);

function parseSort(sort: string) {
  return sort
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [field, direction] = entry.split(":");
      return { field: field || "updated_at", ascending: direction !== "desc" };
    });
}

function parseFilters(raw: string | null): GridFilters {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as GridFilters;
  } catch {
    return {};
  }
}

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfWeekIso() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.toISOString();
}

function mediaCount(row: Record<string, unknown>) {
  const counts = (row.media_counts || { images: 0, videos: 0, documents: 0 }) as { images: number; videos: number; documents: number };
  return counts.images + counts.videos + counts.documents;
}

export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient();
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get("type") || "sale") as GridType;
  const page = Math.max(1, Number(searchParams.get("page") || "1"));
  const pageSize = Math.min(3000, Math.max(10, Number(searchParams.get("pageSize") || "20")));
  const sort = parseSort(searchParams.get("sort") || "updated_at:desc");
  const filters = parseFilters(searchParams.get("filters"));

  const entry = map[type];
  if (!entry) return NextResponse.json({ error: "Unsupported type" }, { status: 400 });

  let query = supabase.from(entry.table).select(entry.select, { count: "exact" });

  if (filters.search) {
    const s = filters.search.replace(/,/g, " ").trim();
    if (type === "sale" || type === "rent") {
      query = query.or(`code.ilike.%${s}%,area.ilike.%${s}%,compound.ilike.%${s}%,notes.ilike.%${s}%,source.ilike.%${s}%`);
    } else if (type === "buyer") {
      query = query.or(`code.ilike.%${s}%,phone.ilike.%${s}%,property_type.ilike.%${s}%,notes.ilike.%${s}%,source.ilike.%${s}%`);
    } else {
      query = query.or(`code.ilike.%${s}%,name.ilike.%${s}%,phone.ilike.%${s}%,area.ilike.%${s}%,source.ilike.%${s}%`);
    }
  }

  if (filters.source) query = query.eq("source", filters.source);
  if (filters.status) query = query.eq("status", filters.status);

  if (type === "sale" || type === "rent") {
    if (filters.currency) query = query.eq("currency", filters.currency);
    if (filters.furnished) query = query.eq("furnished", filters.furnished);
    if (filters.finishing) query = query.eq("finishing", filters.finishing);
    if (filters.payment_terms) query = query.eq("payment_terms", filters.payment_terms);

    if (filters.price?.min) query = query.gte("price", Number(filters.price.min));
    if (filters.price?.max) query = query.lte("price", Number(filters.price.max));
    if (filters.size?.min) query = query.gte("size_sqm", Number(filters.size.min));
    if (filters.size?.max) query = query.lte("size_sqm", Number(filters.size.max));
    if (filters.bedrooms?.min) query = query.gte("bedrooms", Number(filters.bedrooms.min));
    if (filters.bedrooms?.max) query = query.lte("bedrooms", Number(filters.bedrooms.max));
    if (filters.bathrooms?.min) query = query.gte("bathrooms", Number(filters.bathrooms.min));
    if (filters.bathrooms?.max) query = query.lte("bathrooms", Number(filters.bathrooms.max));
    if (filters.floor?.min) query = query.gte("floor", Number(filters.floor.min));
    if (filters.floor?.max) query = query.lte("floor", Number(filters.floor.max));

    if (filters.areas?.length) query = query.in("area", filters.areas);
    if (filters.compounds?.length) query = query.in("compound", filters.compounds);

    if (filters.created_from) query = query.gte("created_at", new Date(filters.created_from).toISOString());
    if (filters.created_to) query = query.lte("created_at", new Date(filters.created_to).toISOString());
    if (filters.updated_from) query = query.gte("updated_at", new Date(filters.updated_from).toISOString());
    if (filters.updated_to) query = query.lte("updated_at", new Date(filters.updated_to).toISOString());

    if (filters.completeness?.min) query = query.gte("completeness_score", Number(filters.completeness.min));
    if (filters.completeness?.max) query = query.lte("completeness_score", Number(filters.completeness.max));

    if (filters.preset === "new_today") query = query.gte("created_at", startOfTodayIso());
    if (filters.preset === "missing_price") query = query.is("price", null);
    if (filters.preset === "missing_location") query = query.or("area.eq.,compound.eq.");
    if (filters.preset === "needs_review") query = query.eq("status", "needs_review");
  }

  if (type === "buyer") {
    if (filters.currency) query = query.eq("currency", filters.currency);
    if (filters.intent) query = query.eq("intent", filters.intent);
    if (filters.property_type) query = query.ilike("property_type", `%${filters.property_type}%`);
    if (filters.preferred_areas?.length) query = query.overlaps("preferred_areas", filters.preferred_areas);

    if (filters.budget?.min) query = query.gte("budget_min", Number(filters.budget.min));
    if (filters.budget?.max) query = query.lte("budget_max", Number(filters.budget.max));
    if (filters.bedrooms_needed_min) query = query.gte("bedrooms_needed", Number(filters.bedrooms_needed_min));

    if (filters.move_timeline) {
      if (filters.move_timeline === "soon") query = query.ilike("timeline", "%soon%");
      else if (filters.move_timeline === "1-3 months") query = query.or("timeline.ilike.%1-3 months%,timeline.ilike.%1 to 3 months%");
      else if (filters.move_timeline === "3-6 months") query = query.or("timeline.ilike.%3-6 months%,timeline.ilike.%3 to 6 months%");
      else if (filters.move_timeline !== "any") query = query.ilike("timeline", `%${filters.move_timeline}%`);
    }

    if (filters.last_contact_from) query = query.gte("last_contact_at", new Date(filters.last_contact_from).toISOString());
    if (filters.last_contact_to) query = query.lte("last_contact_at", new Date(filters.last_contact_to).toISOString());

    if (filters.created_from) query = query.gte("created_at", new Date(filters.created_from).toISOString());
    if (filters.created_to) query = query.lte("created_at", new Date(filters.created_to).toISOString());
    if (filters.updated_from) query = query.gte("updated_at", new Date(filters.updated_from).toISOString());
    if (filters.updated_to) query = query.lte("updated_at", new Date(filters.updated_to).toISOString());

    if (filters.completeness?.min) query = query.gte("completeness_score", Number(filters.completeness.min));
    if (filters.completeness?.max) query = query.lte("completeness_score", Number(filters.completeness.max));

    if (filters.preset === "hot_buyers") query = query.eq("status", "hot");
    if (filters.preset === "missing_phone") query = query.eq("phone", "");
    if (filters.preset === "missing_preferred_areas") query = query.eq("preferred_areas", "{}");
    if (filters.preset === "active_this_week") query = query.gte("updated_at", startOfWeekIso());
  }

  if (type === "client") {
    if (filters.client_type) query = query.eq("role", filters.client_type);
    if (filters.city_area) query = query.ilike("area", `%${filters.city_area}%`);
    if (filters.phone_exists === "yes") query = query.not("phone", "eq", "");
    if (filters.phone_exists === "no") query = query.eq("phone", "");
    if (filters.tags?.length) query = query.overlaps("tags", filters.tags);

    if (filters.created_from) query = query.gte("created_at", new Date(filters.created_from).toISOString());
    if (filters.created_to) query = query.lte("created_at", new Date(filters.created_to).toISOString());
    if (filters.updated_from) query = query.gte("updated_at", new Date(filters.updated_from).toISOString());
    if (filters.updated_to) query = query.lte("updated_at", new Date(filters.updated_to).toISOString());

    if (filters.preset === "new_clients") query = query.gte("created_at", startOfTodayIso());
    if (filters.preset === "missing_phone") query = query.eq("phone", "");
    if (filters.preset === "brokers") query = query.eq("role", "broker");
  }

  sort.forEach((s) => {
    query = query.order(s.field, { ascending: s.ascending, nullsFirst: false });
  });

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await query.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const safeRows = ((data || []) as unknown) as Array<Record<string, unknown>>;
  const ids = safeRows.map((r) => String(r.id || ""));

  const { data: mediaRows } = ids.length
    ? await supabase.from("media").select("record_id, media_type").in("record_id", ids).eq("record_type", entry.table)
    : { data: [] };

  const mediaMap = new Map<string, { images: number; videos: number; documents: number }>();
  (mediaRows || []).forEach((m) => {
    const key = String(m.record_id);
    const item = mediaMap.get(key) || { images: 0, videos: 0, documents: 0 };
    if (m.media_type === "image") item.images += 1;
    else if (m.media_type === "video") item.videos += 1;
    else item.documents += 1;
    mediaMap.set(key, item);
  });

  let rows: Array<Record<string, unknown>> = safeRows.map((row) => ({ ...row, media_counts: mediaMap.get(String(row.id || "")) || { images: 0, videos: 0, documents: 0 } }));

  if (type === "client" && filters.has_active_listings) {
    const { data: saleLinks } = ids.length ? await supabase.from("properties_sale").select("client_id, status").in("client_id", ids) : { data: [] };
    const { data: rentLinks } = ids.length ? await supabase.from("properties_rent").select("client_id, status").in("client_id", ids) : { data: [] };
    const activeByClient = new Set<string>();
    [...(saleLinks || []), ...(rentLinks || [])].forEach((x) => {
      if (x.status === "active") activeByClient.add(String(x.client_id));
    });
    rows = rows.filter((r) => (filters.has_active_listings === "yes" ? activeByClient.has(String(r.id)) : !activeByClient.has(String(r.id))));
  }

  if (filters.has_media === "yes") rows = rows.filter((r) => mediaCount(r) > 0);
  if (filters.has_media === "no") rows = rows.filter((r) => mediaCount(r) === 0);
  if (filters.min_media_count) rows = rows.filter((r) => mediaCount(r) >= Number(filters.min_media_count));

  if ((type === "sale" || type === "rent") && filters.preset === "high_budget") {
    const priced = rows.filter((r) => Number((r as Record<string, unknown>).price || 0) > 0).map((r) => Number((r as Record<string, unknown>).price || 0)).sort((a, b) => a - b);
    if (priced.length > 0) {
      const idx = Math.floor(priced.length * 0.8);
      const threshold = priced[idx] || 0;
      rows = rows.filter((r) => Number((r as Record<string, unknown>).price || 0) >= threshold);
    }
  }

  if (type === "buyer" && filters.preset === "budget_gt_x") {
    rows = rows.filter((r) => Number((r.budget_max as number | null) || 0) >= 3000000);
  }

  if (type === "buyer" && filters.requirements_missing) {
    const wantsMissing = filters.requirements_missing === "yes";
    rows = rows.filter((r) => {
      const missing = (!r.phone || String(r.phone).trim() === "") || (!Array.isArray(r.preferred_areas) || (r.preferred_areas as unknown[]).length === 0);
      return wantsMissing ? missing : !missing;
    });
  }

  if (type === "client" && filters.preset === "has_active_listings") {
    const { data: saleLinks } = ids.length ? await supabase.from("properties_sale").select("client_id, status").in("client_id", ids).eq("status", "active") : { data: [] };
    const { data: rentLinks } = ids.length ? await supabase.from("properties_rent").select("client_id, status").in("client_id", ids).eq("status", "active") : { data: [] };
    const activeByClient = new Set<string>([...(saleLinks || []).map((x) => String(x.client_id)), ...(rentLinks || []).map((x) => String(x.client_id))]);
    rows = rows.filter((r) => activeByClient.has(String(r.id)));
  }

  return NextResponse.json({ rows, total: count || 0, page, pageSize });
}

export async function PATCH(request: NextRequest) {
  const supabase = createSupabaseClient();
  const actor = await getRequestActor(request);
  if (!hasRole(actor.role, "agent")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json()) as { type: GridType; record_id: string; field: string; value: unknown };

  if (!body.type || !body.record_id || !body.field) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  if (!editableByType[body.type]?.has(body.field)) return NextResponse.json({ error: "Field not editable" }, { status: 400 });

  let value: unknown = body.value;
  if (numericFields.has(body.field)) value = String(body.value ?? "").replace(/\D/g, "") || null;
  if (body.field === "preferred_areas" || body.field === "tags") {
    value = Array.isArray(body.value) ? body.value : String(body.value || "").split(",").map((v) => v.trim()).filter(Boolean);
  }

  const patchEntry = map[body.type];
  if (!patchEntry) return NextResponse.json({ error: "Unsupported type" }, { status: 400 });

  const { data: before } = await supabase.from(patchEntry.table).select("*").eq("id", body.record_id).maybeSingle();
  const { error } = await supabase.from(patchEntry.table).update({ [body.field]: value }).eq("id", body.record_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: after } = await supabase.from(patchEntry.table).select("*").eq("id", body.record_id).maybeSingle();
  await writeAuditLog({
    user_id: actor.userId,
    action: `update_${body.field}`,
    record_type: patchEntry.table,
    record_id: body.record_id,
    before_json: (before || {}) as Record<string, unknown>,
    after_json: (after || {}) as Record<string, unknown>,
    source: "grid"
  });

  return NextResponse.json({ ok: true, normalized: value });
}
