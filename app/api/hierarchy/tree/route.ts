import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminActor } from "@/services/auth/role.service";
import { fetchHierarchyTree } from "@/services/hierarchy/hierarchy.service";
import { hierarchyTreeQuerySchema } from "@/services/hierarchy/hierarchy.schemas";

export async function GET(request: NextRequest) {
  try {
    const { errorResponse } = await requireAdminActor(request);
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const query = hierarchyTreeQuerySchema.parse({ family: searchParams.get("family") });
    const result = await fetchHierarchyTree(query.family);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid query", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
