import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestActor } from "@/services/auth/role.service";
import { fetchRecordsByNode } from "@/services/hierarchy/hierarchy.service";
import { nodeRecordsQuerySchema } from "@/services/hierarchy/hierarchy.schemas";

export async function GET(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!actor.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const query = nodeRecordsQuerySchema.parse({
      nodeId: searchParams.get("nodeId"),
      family: searchParams.get("family"),
      includeDescendants: searchParams.get("includeDescendants") ?? "true",
      limit: searchParams.get("limit") ?? "50"
    });

    const rows = await fetchRecordsByNode(query);
    return NextResponse.json({ rows });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid query", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
