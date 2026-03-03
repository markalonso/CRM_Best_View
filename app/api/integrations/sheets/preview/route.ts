import { NextRequest, NextResponse } from "next/server";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { googleSheetsIntegrationService } from "@/services/integrations/google-sheets.service";

type Body = { spreadsheet_id?: string; tab?: string };

export async function POST(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = (await request.json()) as Body;
    if (!body.spreadsheet_id || !body.tab) return NextResponse.json({ error: "spreadsheet_id and tab are required" }, { status: 400 });

    const preview = await googleSheetsIntegrationService.previewTab(body.spreadsheet_id, body.tab);
    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Preview failed" }, { status: 500 });
  }
}
