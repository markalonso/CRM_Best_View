import { NextRequest, NextResponse } from "next/server";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { googleSheetsIntegrationService, type SheetDataset } from "@/services/integrations/google-sheets.service";

type Body = {
  spreadsheet_id?: string;
  payloads?: Array<{ dataset: SheetDataset; rows: Array<Record<string, unknown>> }>;
};

export async function POST(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = (await request.json()) as Body;
    if (!Array.isArray(body.payloads) || !body.payloads.length) return NextResponse.json({ error: "payloads required" }, { status: 400 });

    const results = [];
    for (const payload of body.payloads) {
      const result = await googleSheetsIntegrationService.exportRows(payload.dataset, payload.rows || [], body.spreadsheet_id);
      results.push({ dataset: payload.dataset, ...result });
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 500 });
  }
}
