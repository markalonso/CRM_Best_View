import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";

type TimelineEvent = {
  id: string;
  action: string;
  record_type: string;
  record_id: string;
  created_at: string;
  details: Record<string, unknown>;
  record_code?: string;
};

const CACHE_TTL_MS = 60_000;
let cache: { expiresAt: number; payload: unknown } | null = null;

function dayKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function lastDays(count: number) {
  const keys: string[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

function avgByTopLabel(rows: Array<{ label: string; value: number }>, top = 10) {
  const map = new Map<string, { sum: number; count: number }>();
  rows.forEach((row) => {
    if (!row.label.trim() || Number.isNaN(row.value) || row.value <= 0) return;
    const current = map.get(row.label) || { sum: 0, count: 0 };
    current.sum += row.value;
    current.count += 1;
    map.set(row.label, current);
  });

  return [...map.entries()]
    .map(([label, value]) => ({ label, avg: Math.round(value.sum / value.count) }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, top);
}

export async function GET() {
  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json(cache.payload, { headers: { "x-dashboard-cache": "HIT" } });
  }

  const supabase = createSupabaseClient();
  const dayKeys = lastDays(14);
  const fromIso = `${dayKeys[0]}T00:00:00.000Z`;
  const todayIso = `${dayKeys[dayKeys.length - 1]}T00:00:00.000Z`;

  const [
    saleTotal,
    rentTotal,
    buyerTotal,
    clientTotal,
    intakeToday,
    saleNeedsReview,
    rentNeedsReview,
    buyerNeedsReview,
    clientNeedsReview,
    inboxNeedsReview,
    saleTrend,
    rentTrend,
    buyerTrend,
    clientTrend,
    intakeTrend,
    qualitySaleMissingPrice,
    qualitySaleMissingLocation,
    qualityBuyerMissingBudget,
    qualityClientMissingPhone,
    saleMarket,
    rentMarket,
    buyerMarket,
    timelineRes
  ] = await Promise.all([
    supabase.from("properties_sale").select("id", { count: "exact", head: true }),
    supabase.from("properties_rent").select("id", { count: "exact", head: true }),
    supabase.from("buyers").select("id", { count: "exact", head: true }),
    supabase.from("clients").select("id", { count: "exact", head: true }),
    supabase.from("intake_sessions").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
    supabase.from("properties_sale").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
    supabase.from("properties_rent").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
    supabase.from("buyers").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
    supabase.from("intake_sessions").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
    supabase.from("properties_sale").select("created_at,status").gte("created_at", fromIso),
    supabase.from("properties_rent").select("created_at,status").gte("created_at", fromIso),
    supabase.from("buyers").select("created_at,status").gte("created_at", fromIso),
    supabase.from("clients").select("created_at,status").gte("created_at", fromIso),
    supabase.from("intake_sessions").select("created_at,status").gte("created_at", fromIso),
    supabase.from("properties_sale").select("id", { count: "exact", head: true }).is("price", null),
    supabase.from("properties_sale").select("id", { count: "exact", head: true }).or("area.eq.,compound.eq."),
    supabase.from("buyers").select("id", { count: "exact", head: true }).is("budget_min", null).is("budget_max", null),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("phone", ""),
    supabase.from("properties_sale").select("area,price").not("price", "is", null),
    supabase.from("properties_rent").select("area,price").not("price", "is", null),
    supabase.from("buyers").select("preferred_areas,budget_min,budget_max"),
    supabase.from("timeline").select("id,action,record_type,record_id,created_at,details").order("created_at", { ascending: false }).limit(20)
  ]);

  const trendsMap = new Map(dayKeys.map((key) => [key, { date: key, sale: 0, rent: 0, buyer: 0, client: 0, intake: 0, confirmed: 0, needs_review: 0 }]));

  (saleTrend.data || []).forEach((row) => {
    const key = dayKey(String(row.created_at));
    const item = trendsMap.get(key);
    if (!item) return;
    item.sale += 1;
    if (String(row.status) === "needs_review") item.needs_review += 1;
    else item.confirmed += 1;
  });
  (rentTrend.data || []).forEach((row) => {
    const key = dayKey(String(row.created_at));
    const item = trendsMap.get(key);
    if (!item) return;
    item.rent += 1;
    if (String(row.status) === "needs_review") item.needs_review += 1;
    else item.confirmed += 1;
  });
  (buyerTrend.data || []).forEach((row) => {
    const key = dayKey(String(row.created_at));
    const item = trendsMap.get(key);
    if (!item) return;
    item.buyer += 1;
    if (String(row.status) === "needs_review") item.needs_review += 1;
    else item.confirmed += 1;
  });
  (clientTrend.data || []).forEach((row) => {
    const key = dayKey(String(row.created_at));
    const item = trendsMap.get(key);
    if (!item) return;
    item.client += 1;
    if (String(row.status) === "needs_review") item.needs_review += 1;
    else item.confirmed += 1;
  });
  (intakeTrend.data || []).forEach((row) => {
    const key = dayKey(String(row.created_at));
    const item = trendsMap.get(key);
    if (!item) return;
    item.intake += 1;
  });

  const timelineRows = (timelineRes.data || []) as TimelineEvent[];
  const recordIdsByType = {
    properties_sale: [] as string[],
    properties_rent: [] as string[],
    buyers: [] as string[],
    clients: [] as string[]
  };
  timelineRows.forEach((row) => {
    if (row.record_type in recordIdsByType) {
      recordIdsByType[row.record_type as keyof typeof recordIdsByType].push(String(row.record_id));
    }
  });

  const [saleCodes, rentCodes, buyerCodes, clientCodes] = await Promise.all([
    recordIdsByType.properties_sale.length ? supabase.from("properties_sale").select("id,code").in("id", recordIdsByType.properties_sale) : { data: [] },
    recordIdsByType.properties_rent.length ? supabase.from("properties_rent").select("id,code").in("id", recordIdsByType.properties_rent) : { data: [] },
    recordIdsByType.buyers.length ? supabase.from("buyers").select("id,code").in("id", recordIdsByType.buyers) : { data: [] },
    recordIdsByType.clients.length ? supabase.from("clients").select("id,code").in("id", recordIdsByType.clients) : { data: [] }
  ]);

  const codeMap = new Map<string, string>();
  [...(saleCodes.data || []), ...(rentCodes.data || []), ...(buyerCodes.data || []), ...(clientCodes.data || [])].forEach((row) => {
    codeMap.set(String(row.id), String(row.code || ""));
  });

  const payload = {
    kpis: {
      sale_total: saleTotal.count || 0,
      rent_total: rentTotal.count || 0,
      buyer_total: buyerTotal.count || 0,
      client_total: clientTotal.count || 0,
      intake_today: intakeToday.count || 0,
      needs_review_total: (saleNeedsReview.count || 0) + (rentNeedsReview.count || 0) + (buyerNeedsReview.count || 0) + (clientNeedsReview.count || 0) + (inboxNeedsReview.count || 0)
    },
    trends: [...trendsMap.values()],
    market: {
      sale_avg_by_area: avgByTopLabel((saleMarket.data || []).map((row) => ({ label: String(row.area || ""), value: Number(row.price || 0) }))),
      rent_avg_by_area: avgByTopLabel((rentMarket.data || []).map((row) => ({ label: String(row.area || ""), value: Number(row.price || 0) }))),
      buyer_avg_budget_by_area: avgByTopLabel(
        (buyerMarket.data || []).flatMap((row) => {
          const areas = Array.isArray(row.preferred_areas) ? row.preferred_areas : [];
          const budget = Number(row.budget_max || row.budget_min || 0);
          return areas.map((area: unknown) => ({ label: String(area || ""), value: budget }));
        })
      )
    },
    data_quality: {
      sale_missing_price: qualitySaleMissingPrice.count || 0,
      sale_missing_location: qualitySaleMissingLocation.count || 0,
      buyer_missing_budget: qualityBuyerMissingBudget.count || 0,
      client_missing_phone: qualityClientMissingPhone.count || 0
    },
    activity: timelineRows.map((row) => ({
      ...row,
      record_code: codeMap.get(String(row.record_id)) || String(row.record_id).slice(0, 8)
    }))
  };

  cache = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
  return NextResponse.json(payload, { headers: { "x-dashboard-cache": "MISS" } });
}
