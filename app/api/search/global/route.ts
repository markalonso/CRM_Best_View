import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";

type SearchRecordType = "sale" | "rent" | "buyer" | "client" | "inbox" | "media";

type SearchItem = {
  id: string;
  record_type: SearchRecordType;
  code: string;
  primary_label: string;
  secondary_info: string;
  needs_review: boolean;
  updated_at?: string;
  media_counts?: { images: number; videos: number; documents: number };
  href: string;
};

const LIMIT_PER_TYPE = 7;

function mediaCounter(rows: Array<{ record_id: string; media_type: string }>) {
  const map = new Map<string, { images: number; videos: number; documents: number }>();
  rows.forEach((row) => {
    const current = map.get(String(row.record_id)) || { images: 0, videos: 0, documents: 0 };
    if (row.media_type === "image") current.images += 1;
    else if (row.media_type === "video") current.videos += 1;
    else current.documents += 1;
    map.set(String(row.record_id), current);
  });
  return map;
}

function intakeMediaCounter(rows: Array<{ intake_session_id: string; media_type: string }>) {
  const map = new Map<string, { images: number; videos: number; documents: number }>();
  rows.forEach((row) => {
    const current = map.get(String(row.intake_session_id)) || { images: 0, videos: 0, documents: 0 };
    if (row.media_type === "image") current.images += 1;
    else if (row.media_type === "video") current.videos += 1;
    else current.documents += 1;
    map.set(String(row.intake_session_id), current);
  });
  return map;
}

function mostlyDigits(input: string) {
  const digits = (input.match(/\d/g) || []).length;
  const letters = (input.match(/[A-Za-z\u0600-\u06FF]/g) || []).length;
  return digits >= 3 && digits >= letters;
}

export async function GET(request: NextRequest) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ query: "", groups: [] });

  const qLike = `%${q}%`;
  const numberTerm = Number(q.replace(/\D/g, ""));
  const numericMode = mostlyDigits(q);
  const codeMode = /^(sale|rent|buyer|client|inbox|intake)-/i.test(q) || /(sale-|rent-|buyer-|client-)/i.test(q);
  const supabase = createSupabaseClient();

  const [saleExact, rentExact, buyerExact, clientExact] = await Promise.all([
    supabase.from("properties_sale").select("id, code, status, area, compound, price, currency, updated_at").or(`code.ilike.${qLike}${numericMode ? `,price.eq.${numberTerm || 0}` : ""}`).limit(LIMIT_PER_TYPE),
    supabase.from("properties_rent").select("id, code, status, area, compound, price, currency, updated_at").or(`code.ilike.${qLike}${numericMode ? `,price.eq.${numberTerm || 0}` : ""}`).limit(LIMIT_PER_TYPE),
    supabase.from("buyers").select("id, code, status, intent, property_type, budget_min, budget_max, currency, phone, updated_at").or(`code.ilike.${qLike},phone.ilike.${qLike}${numericMode ? `,budget_max.eq.${numberTerm || 0},budget_min.eq.${numberTerm || 0}` : ""}`).limit(LIMIT_PER_TYPE),
    supabase.from("clients").select("id, code, status, name, role, phone, area, updated_at").or(`code.ilike.${qLike},name.ilike.${qLike},phone.ilike.${qLike}`).limit(LIMIT_PER_TYPE)
  ]);

  const [saleFuzzy, rentFuzzy, buyerFuzzy, clientFuzzy, inboxFuzzy] = await Promise.all([
    supabase.from("properties_sale").select("id, code, status, area, compound, price, currency, notes, updated_at").or(`area.ilike.${qLike},compound.ilike.${qLike},notes.ilike.${qLike}`).limit(LIMIT_PER_TYPE),
    supabase.from("properties_rent").select("id, code, status, area, compound, price, currency, notes, updated_at").or(`area.ilike.${qLike},compound.ilike.${qLike},notes.ilike.${qLike}`).limit(LIMIT_PER_TYPE),
    supabase.from("buyers").select("id, code, status, intent, property_type, budget_min, budget_max, currency, phone, notes, updated_at").or(`intent.ilike.${qLike},property_type.ilike.${qLike},notes.ilike.${qLike}`).limit(LIMIT_PER_TYPE),
    supabase.from("clients").select("id, code, status, name, role, phone, area, updated_at").or(`name.ilike.${qLike},area.ilike.${qLike},source.ilike.${qLike}`).limit(LIMIT_PER_TYPE),
    supabase.from("intake_sessions").select("id, status, type_detected, raw_text, created_at, updated_at").or(`raw_text.ilike.${qLike},type_detected.ilike.${qLike}`).order("created_at", { ascending: false }).limit(LIMIT_PER_TYPE)
  ]);

  const saleRows = [...(saleExact.data || []), ...(saleFuzzy.data || [])].filter((row, i, arr) => arr.findIndex((x) => x.id === row.id) === i).slice(0, LIMIT_PER_TYPE);
  const rentRows = [...(rentExact.data || []), ...(rentFuzzy.data || [])].filter((row, i, arr) => arr.findIndex((x) => x.id === row.id) === i).slice(0, LIMIT_PER_TYPE);
  const buyerRows = [...(buyerExact.data || []), ...(buyerFuzzy.data || [])].filter((row, i, arr) => arr.findIndex((x) => x.id === row.id) === i).slice(0, LIMIT_PER_TYPE);
  const clientRows = [...(clientExact.data || []), ...(clientFuzzy.data || [])].filter((row, i, arr) => arr.findIndex((x) => x.id === row.id) === i).slice(0, LIMIT_PER_TYPE);
  const inboxRows = (inboxFuzzy.data || []).slice(0, LIMIT_PER_TYPE);

  const saleIds = saleRows.map((row) => String(row.id));
  const rentIds = rentRows.map((row) => String(row.id));
  const buyerIds = buyerRows.map((row) => String(row.id));
  const clientIds = clientRows.map((row) => String(row.id));
  const inboxIds = inboxRows.map((row) => String(row.id));

  const [saleMedia, rentMedia, buyerMedia, clientMedia, inboxMedia, mediaRows] = await Promise.all([
    saleIds.length ? supabase.from("media").select("record_id, media_type").eq("record_type", "properties_sale").in("record_id", saleIds) : { data: [] },
    rentIds.length ? supabase.from("media").select("record_id, media_type").eq("record_type", "properties_rent").in("record_id", rentIds) : { data: [] },
    buyerIds.length ? supabase.from("media").select("record_id, media_type").eq("record_type", "buyers").in("record_id", buyerIds) : { data: [] },
    clientIds.length ? supabase.from("media").select("record_id, media_type").eq("record_type", "clients").in("record_id", clientIds) : { data: [] },
    inboxIds.length ? supabase.from("media").select("intake_session_id, media_type").in("intake_session_id", inboxIds) : { data: [] },
    supabase.from("media").select("id, record_type, record_id, original_filename, media_type, created_at").or(`original_filename.ilike.${qLike},file_url.ilike.${qLike}`).order("created_at", { ascending: false }).limit(5)
  ]);

  const saleMediaMap = mediaCounter((saleMedia.data || []) as Array<{ record_id: string; media_type: string }>);
  const rentMediaMap = mediaCounter((rentMedia.data || []) as Array<{ record_id: string; media_type: string }>);
  const buyerMediaMap = mediaCounter((buyerMedia.data || []) as Array<{ record_id: string; media_type: string }>);
  const clientMediaMap = mediaCounter((clientMedia.data || []) as Array<{ record_id: string; media_type: string }>);
  const inboxMediaMap = intakeMediaCounter((inboxMedia.data || []) as Array<{ intake_session_id: string; media_type: string }>);

  const saleItems: SearchItem[] = saleRows.map((row) => ({
    id: String(row.id),
    record_type: "sale",
    code: String(row.code || "-"),
    primary_label: [row.area, row.compound].filter(Boolean).join(" • ") || "Sale property",
    secondary_info: `${row.price ? `${Number(row.price).toLocaleString()} ${row.currency || ""}` : "No price"} • ${row.updated_at ? new Date(row.updated_at).toLocaleDateString() : ""}`,
    needs_review: row.status === "needs_review",
    updated_at: String(row.updated_at || ""),
    media_counts: saleMediaMap.get(String(row.id)) || { images: 0, videos: 0, documents: 0 },
    href: `/sale?open=${row.id}`
  }));

  const rentItems: SearchItem[] = rentRows.map((row) => ({
    id: String(row.id),
    record_type: "rent",
    code: String(row.code || "-"),
    primary_label: [row.area, row.compound].filter(Boolean).join(" • ") || "Rent property",
    secondary_info: `${row.price ? `${Number(row.price).toLocaleString()} ${row.currency || ""}` : "No price"} • ${row.updated_at ? new Date(row.updated_at).toLocaleDateString() : ""}`,
    needs_review: row.status === "needs_review",
    updated_at: String(row.updated_at || ""),
    media_counts: rentMediaMap.get(String(row.id)) || { images: 0, videos: 0, documents: 0 },
    href: `/rent?open=${row.id}`
  }));

  const buyerItems: SearchItem[] = buyerRows.map((row) => ({
    id: String(row.id),
    record_type: "buyer",
    code: String(row.code || "-"),
    primary_label: `${row.intent || "Buyer"}${row.property_type ? ` • ${row.property_type}` : ""}`,
    secondary_info: `${row.budget_min || row.budget_max ? `${Number(row.budget_min || 0).toLocaleString()} - ${Number(row.budget_max || 0).toLocaleString()} ${row.currency || ""}` : "No budget"}${row.phone ? ` • ${row.phone}` : ""}`,
    needs_review: row.status === "needs_review",
    updated_at: String(row.updated_at || ""),
    media_counts: buyerMediaMap.get(String(row.id)) || { images: 0, videos: 0, documents: 0 },
    href: `/buyers?open=${row.id}`
  }));

  const clientItems: SearchItem[] = clientRows.map((row) => ({
    id: String(row.id),
    record_type: "client",
    code: String(row.code || "-"),
    primary_label: String(row.name || "Client"),
    secondary_info: `${row.role || ""}${row.phone ? ` • ${row.phone}` : ""}${row.area ? ` • ${row.area}` : ""}`,
    needs_review: row.status === "needs_review",
    updated_at: String(row.updated_at || ""),
    media_counts: clientMediaMap.get(String(row.id)) || { images: 0, videos: 0, documents: 0 },
    href: `/clients?open=${row.id}`
  }));

  const inboxItems: SearchItem[] = inboxRows.map((row) => ({
    id: String(row.id),
    record_type: "inbox",
    code: `INBOX-${String(row.id).slice(0, 8)}`,
    primary_label: String(row.type_detected || "intake").toUpperCase(),
    secondary_info: String(row.raw_text || "").slice(0, 90),
    needs_review: row.status === "needs_review",
    updated_at: String(row.updated_at || row.created_at || ""),
    media_counts: inboxMediaMap.get(String(row.id)) || { images: 0, videos: 0, documents: 0 },
    href: `/inbox/${row.id}`
  }));

  const mediaItems: SearchItem[] = (mediaRows.data || []).map((row) => ({
    id: String(row.id),
    record_type: "media",
    code: `MEDIA-${String(row.id).slice(0, 8)}`,
    primary_label: String(row.original_filename || "Media file"),
    secondary_info: `${row.record_type || "unlinked"}${row.record_id ? ` • ${String(row.record_id).slice(0, 8)}` : ""}`,
    needs_review: false,
    updated_at: String(row.created_at || ""),
    media_counts: {
      images: row.media_type === "image" ? 1 : 0,
      videos: row.media_type === "video" ? 1 : 0,
      documents: row.media_type === "document" || row.media_type === "other" ? 1 : 0
    },
    href: "/media"
  }));

  const grouped = [
    { key: "sale", label: "Sale", items: saleItems },
    { key: "rent", label: "Rent", items: rentItems },
    { key: "buyer", label: "Buyers", items: buyerItems },
    { key: "client", label: "Clients", items: clientItems },
    { key: "inbox", label: "Inbox", items: inboxItems },
    { key: "media", label: "Media", items: mediaItems }
  ]
    .map((group) => ({ ...group, count: group.items.length }))
    .filter((group) => group.count > 0)
    .sort((a, b) => {
      if (codeMode) {
        const aScore = a.items.filter((item) => item.code.toLowerCase().includes(q.toLowerCase())).length;
        const bScore = b.items.filter((item) => item.code.toLowerCase().includes(q.toLowerCase())).length;
        return bScore - aScore;
      }
      return b.count - a.count;
    });

  return NextResponse.json({
    query: q,
    groups: grouped,
    quick_actions: [{ id: "quick-intake", label: "Quick create intake", href: "/inbox?quickCreate=1" }]
  });
}
