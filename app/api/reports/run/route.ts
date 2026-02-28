import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";

type Dataset = "sale" | "rent" | "buyer" | "client";
type GroupBy = "area" | "compound" | "status" | "furnished" | "finishing" | "source" | "currency" | "preferred_area";
type Metric = "count" | "avg" | "min" | "max";

type ReportFilters = {
  date_from?: string;
  date_to?: string;
  area?: string;
  status?: string;
  price_min?: string;
  price_max?: string;
  currency?: string;
};

type ReportRow = Record<string, string | number | string[] | undefined | null> & {
  id?: string;
  area?: string;
  compound?: string;
  status?: string;
  furnished?: string;
  finishing?: string;
  source?: string;
  currency?: string;
  price?: string | number;
  budget?: string | number;
  budget_min?: string | number;
  budget_max?: string | number;
  preferred_areas?: string[];
  created_at?: string;
};

type RunReportBody = {
  dataset?: Dataset;
  groupBy?: GroupBy;
  metrics?: Metric[];
  filters?: ReportFilters;
  template?: "sale_by_area" | "rent_by_area" | "buyers_by_preferred_area" | "needs_review_breakdown";
  currency_mode?: "split" | "single";
  currency_target?: string;
};

function num(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function average(values: number[]) {
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function applyCommonFilters(query: any, filters: ReportFilters, dataset: Dataset) {
  if (filters.date_from) query = query.gte("created_at", new Date(filters.date_from).toISOString());
  if (filters.date_to) query = query.lte("created_at", new Date(filters.date_to).toISOString());
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.currency && (dataset === "sale" || dataset === "rent" || dataset === "buyer")) query = query.eq("currency", filters.currency);

  if (dataset === "sale" || dataset === "rent") {
    if (filters.area) query = query.ilike("area", `%${filters.area}%`);
    if (filters.price_min) query = query.gte("price", Number(filters.price_min));
    if (filters.price_max) query = query.lte("price", Number(filters.price_max));
  }

  if (dataset === "buyer") {
    if (filters.area) query = query.overlaps("preferred_areas", [filters.area]);
    if (filters.price_min) query = query.gte("budget_min", Number(filters.price_min));
    if (filters.price_max) query = query.lte("budget_max", Number(filters.price_max));
  }

  if (dataset === "client" && filters.area) query = query.ilike("area", `%${filters.area}%`);

  return query;
}

function buildTemplateConfig(template: NonNullable<RunReportBody["template"]>) {
  if (template === "sale_by_area") return { dataset: "sale" as const, groupBy: "area" as const, metrics: ["count", "avg"] as Metric[] };
  if (template === "rent_by_area") return { dataset: "rent" as const, groupBy: "area" as const, metrics: ["count", "avg"] as Metric[] };
  if (template === "buyers_by_preferred_area") return { dataset: "buyer" as const, groupBy: "preferred_area" as const, metrics: ["count", "avg"] as Metric[] };
  return null;
}

async function runNeedsReviewBreakdown() {
  const supabase = createSupabaseClient();
  const [saleRows, rentRows, buyerRows, clientRows] = await Promise.all([
    supabase.from("properties_sale").select("id,status,price,area,compound").eq("status", "needs_review"),
    supabase.from("properties_rent").select("id,status,price,area,compound").eq("status", "needs_review"),
    supabase.from("buyers").select("id,status,budget_min,budget_max,phone,preferred_areas").eq("status", "needs_review"),
    supabase.from("clients").select("id,status,phone,name").eq("status", "needs_review")
  ]);

  const rows = [
    {
      record_type: "sale",
      missing_field: "price",
      count: (saleRows.data || []).filter((r) => r.price == null).length,
      drilldown_href: "/sale?status=needs_review&preset=missing_price"
    },
    {
      record_type: "sale",
      missing_field: "location",
      count: (saleRows.data || []).filter((r) => !r.area || !r.compound).length,
      drilldown_href: "/sale?status=needs_review&preset=missing_location"
    },
    {
      record_type: "rent",
      missing_field: "price",
      count: (rentRows.data || []).filter((r) => r.price == null).length,
      drilldown_href: "/rent?status=needs_review&preset=missing_price"
    },
    {
      record_type: "buyer",
      missing_field: "budget",
      count: (buyerRows.data || []).filter((r) => r.budget_min == null && r.budget_max == null).length,
      drilldown_href: "/buyers?status=needs_review&requirements_missing=yes"
    },
    {
      record_type: "client",
      missing_field: "phone",
      count: (clientRows.data || []).filter((r) => !r.phone || !String(r.phone).trim()).length,
      drilldown_href: "/clients?status=needs_review&phone_exists=no"
    }
  ];

  return NextResponse.json({
    columns: ["record_type", "missing_field", "count"],
    rows,
    total: rows.reduce((a, b) => a + b.count, 0)
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as RunReportBody;

  if (body.template === "needs_review_breakdown") return runNeedsReviewBreakdown();

  const templateConfig = body.template ? buildTemplateConfig(body.template) : null;
  const dataset = templateConfig?.dataset || body.dataset;
  const groupBy = templateConfig?.groupBy || body.groupBy;
  const metrics = (templateConfig?.metrics || body.metrics || ["count"]) as Metric[];
  const filters = body.filters || {};

  if (!dataset || !groupBy) return NextResponse.json({ error: "dataset and groupBy are required" }, { status: 400 });

  const supabase = createSupabaseClient();

  const tableByDataset: Record<Dataset, string> = {
    sale: "properties_sale",
    rent: "properties_rent",
    buyer: "buyers",
    client: "clients"
  };

  const selectByDataset: Record<Dataset, string> = {
    sale: "id,area,compound,status,furnished,finishing,source,currency,price,created_at",
    rent: "id,area,compound,status,furnished,finishing,source,currency,price,created_at",
    buyer: "id,status,source,currency,budget_min,budget_max,preferred_areas,created_at",
    client: "id,area,status,source,created_at"
  };

  let query = supabase.from(tableByDataset[dataset]).select(selectByDataset[dataset]);
  query = applyCommonFilters(query, filters, dataset);

  const { data, error } = await query.limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const groups = new Map<string, { count: number; nums: number[]; filterValue: string; currency?: string }>();

  const reportRows = (data || []) as ReportRow[];

  reportRows.forEach((rawRow) => {
    const row = rawRow;
    const getBudget = () => {
      if (dataset !== "buyer") return null;
      const b = num(row.budget_max ?? row.budget ?? row.budget_min);
      return b > 0 ? b : null;
    };

    const valueNumber = dataset === "sale" || dataset === "rent" ? (row.price == null ? null : num(row.price)) : getBudget();

    const rawGroup = (() => {
      if (groupBy === "preferred_area") {
        const areas = Array.isArray(row.preferred_areas) ? row.preferred_areas : [];
        return areas.length ? areas : ["(No Area)"];
      }
      if (groupBy === "area") return [String(row.area || "(No Area)")];
      if (groupBy === "compound") return [String(row.compound || "(No Compound)")];
      if (groupBy === "status") return [String(row.status || "(No Status)")];
      if (groupBy === "furnished") return [String(row.furnished || "(Unknown)")];
      if (groupBy === "finishing") return [String(row.finishing || "(Unknown)")];
      if (groupBy === "currency") return [String(row.currency || "(No Currency)")];
      return [String(row.source || "(No Source)")];
    })();

    rawGroup.forEach((item) => {
      const currencyTag = body.currency_mode === "split" ? ` | ${String(row.currency || "")}` : "";
      const key = `${item}${currencyTag}`;
      const current = groups.get(key) || { count: 0, nums: [], filterValue: String(item), currency: String(row.currency || "") };
      current.count += 1;
      if (valueNumber != null && valueNumber > 0) current.nums.push(valueNumber);
      groups.set(key, current);
    });
  });

  const rows = [...groups.entries()].map(([label, value]) => {
    const result: Record<string, unknown> = {
      group: label,
      count: value.count
    };

    if (metrics.includes("avg")) result.avg = average(value.nums);
    if (metrics.includes("min")) result.min = value.nums.length ? Math.min(...value.nums) : null;
    if (metrics.includes("max")) result.max = value.nums.length ? Math.max(...value.nums) : null;

    const baseHref = dataset === "sale" ? "/sale" : dataset === "rent" ? "/rent" : dataset === "buyer" ? "/buyers" : "/clients";
    const qs = new URLSearchParams();

    if (groupBy === "area" || groupBy === "preferred_area") qs.set("q", value.filterValue);
    if (groupBy === "status") qs.set("status", value.filterValue);
    if (groupBy === "source") qs.set("source", value.filterValue);
    if (groupBy === "compound") qs.set("q", value.filterValue);
    if (groupBy === "furnished" || groupBy === "finishing") qs.set("q", value.filterValue);
    if (value.currency && body.currency_mode === "split") qs.set("currency", value.currency);

    result.drilldown_href = `${baseHref}?${qs.toString()}`;
    return result;
  });

  rows.sort((a, b) => Number((b.count as number) || 0) - Number((a.count as number) || 0));

  return NextResponse.json({
    dataset,
    groupBy,
    metrics,
    columns: ["group", ...metrics.map((m) => (m === "count" ? "count" : m)), "drilldown_href"],
    rows
  });
}
