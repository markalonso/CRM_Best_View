import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminActor } from "@/services/auth/role.service";
import { fetchMediaByNode } from "@/services/hierarchy/hierarchy.service";
import { nodeMediaQuerySchema } from "@/services/hierarchy/hierarchy.schemas";

export async function GET(request: NextRequest) {
  try {
    const { errorResponse } = await requireAdminActor(request);
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const query = nodeMediaQuerySchema.parse({
      nodeId: searchParams.get("nodeId"),
      includeDescendants: searchParams.get("includeDescendants") ?? "true",
      limit: searchParams.get("limit") ?? "100"
    });

    const media = await fetchMediaByNode(query);
    return NextResponse.json({ media });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid query", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
