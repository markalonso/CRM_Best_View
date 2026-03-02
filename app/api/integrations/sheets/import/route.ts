import { NextRequest, NextResponse } from "next/server";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { createSupabaseClient } from "@/services/supabase/client";
import { googleSheetsIntegrationService, type SheetDataset } from "@/services/integrations/google-sheets.service";

type Mapping = {
  dataset: SheetDataset;
  tab: string;
  column_map: Record<string, string>;
};

type Body = {
  spreadsheet_id?: string;
  mappings?: Mapping[];
};

const FIELDS_BY_DATASET: Record<Exclude<SheetDataset, "inbox">, string[]> = {
  sale: ["code", "source", "price", "currency", "size_sqm", "bedrooms", "bathrooms", "area", "compound", "floor", "furnished", "finishing", "payment_terms", "notes", "status"],
  rent: ["code", "source", "price", "currency", "size_sqm", "bedrooms", "bathrooms", "area", "compound", "floor", "furnished", "finishing", "payment_terms", "notes", "status"],
  buyer: ["code", "source", "phone", "currency", "intent", "property_type", "budget_min", "budget_max", "preferred_areas", "bedrooms_needed", "timeline", "notes", "status"],
  client: ["code", "source", "name", "phone", "role", "area", "tags", "status"]
};

function scoreCompleteness(dataset: Exclude<SheetDataset, "inbox">, data: Record<string, unknown>) {
  const required = dataset === "sale" || dataset === "rent"
    ? ["price", "area", "source"]
    : dataset === "buyer"
      ? ["phone", "budget_max", "preferred_areas"]
      : ["name", "phone", "source"];

  const ok = required.filter((k) => {
    const v = data[k];
    if (Array.isArray(v)) return v.length > 0;
    return String(v || "").trim().length > 0;
  }).length;

  return Math.round((ok / required.length) * 100);
}

function normalizeForDataset(dataset: Exclude<SheetDataset, "inbox">, raw: Record<string, string>) {
  const fields = FIELDS_BY_DATASET[dataset];
  const out: Record<string, unknown> = {};

  fields.forEach((f) => {
    let v: unknown = raw[f] || "";
    if (["price", "size_sqm", "budget_min", "budget_max", "bedrooms", "bathrooms", "floor", "bedrooms_needed"].includes(f)) {
      const numeric = String(v).replace(/[^\d.]/g, "");
      v = numeric ? Number(numeric) : null;
    }
    if (f === "preferred_areas" || f === "tags") {
      v = String(v || "").split("|").map((x) => x.trim()).filter(Boolean);
    }
    out[f] = v;
  });

  return out;
}

function buildRawText(dataset: Exclude<SheetDataset, "inbox">, mapped: Record<string, unknown>) {
  const lines = Object.entries(mapped)
    .filter(([, v]) => v !== null && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  return `[Google Sheets ${dataset}]\n${lines.join("\n")}`;
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = (await request.json()) as Body;
    if (!body.spreadsheet_id || !Array.isArray(body.mappings) || !body.mappings.length) {
      return NextResponse.json({ error: "spreadsheet_id and mappings are required" }, { status: 400 });
    }

    const supabase = createSupabaseClient();
    const created: Array<{ dataset: string; intake_session_id: string }> = [];

    for (const mapping of body.mappings) {
      if (mapping.dataset === "inbox") continue;
      const dataset = mapping.dataset as Exclude<SheetDataset, "inbox">;

      const { records } = await googleSheetsIntegrationService.readTab(body.spreadsheet_id, mapping.tab);
      for (const row of records) {
        const mapped: Record<string, string> = {};
        Object.entries(mapping.column_map || {}).forEach(([sheetCol, appField]) => {
          if (!appField) return;
          mapped[appField] = String(row[sheetCol] || "");
        });

        const aiJson = normalizeForDataset(dataset, mapped);
        const completeness = scoreCompleteness(dataset, aiJson);
        const status = completeness >= 70 ? "draft" : "needs_review";

        const { data: session, error } = await supabase.from("intake_sessions").insert({
          raw_text: buildRawText(dataset, aiJson),
          status,
          type_detected: "",
          type_confirmed: dataset,
          ai_json: aiJson,
          ai_meta: {
            integration_source: "google_sheets",
            sheet_tab: mapping.tab,
            sheet_row_data: row,
            mapped_fields: Object.keys(mapped)
          },
          completeness_score: completeness
        }).select("id").single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (session?.id) created.push({ dataset, intake_session_id: session.id });
      }
    }

    return NextResponse.json({ ok: true, created_count: created.length, created });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed" }, { status: 500 });
  }
}
