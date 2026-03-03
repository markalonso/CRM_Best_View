import { NextRequest, NextResponse } from "next/server";
import { googleSheetsIntegrationService, type SheetDataset } from "@/services/integrations/google-sheets.service";

type Body = {
  dataset?: SheetDataset;
  rows?: Array<Record<string, unknown>>;
  spreadsheet_id?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    if (!body.dataset || !Array.isArray(body.rows)) return NextResponse.json({ error: "dataset and rows are required" }, { status: 400 });

    const result = await googleSheetsIntegrationService.exportRows(body.dataset, body.rows, body.spreadsheet_id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Export failed" }, { status: 500 });
  }
}
