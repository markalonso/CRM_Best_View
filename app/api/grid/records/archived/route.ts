import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminActor } from "@/services/auth/role.service";
import { fetchArchivedRecords } from "@/services/records/record-archive.service";

const querySchema = z.object({
  type: z.enum(["sale", "rent", "buyer", "client"]),
  nodeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(10).max(3000).optional().default(20),
  archiveScope: z.enum(["active", "archived", "all"]).optional().default("archived")
});

export async function GET(request: NextRequest) {
  try {
    const { errorResponse } = await requireAdminActor(request);
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      type: searchParams.get("type"),
      nodeId: searchParams.get("nodeId") || undefined,
      page: searchParams.get("page") || "1",
      pageSize: searchParams.get("pageSize") || "20",
      archiveScope: searchParams.get("archiveScope") || "archived"
    });

    const result = await fetchArchivedRecords(query);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid archived-record query", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.toLowerCase().includes("hierarchy node")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
