import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/services/audit/audit-log.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { createHierarchyDestinationNode, fetchAllowedHierarchyDestinationNodes } from "@/services/hierarchy/hierarchy.service";
import { createHierarchyDestinationSchema, hierarchyAllowedDestinationsQuerySchema } from "@/services/hierarchy/hierarchy.schemas";

export async function GET(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!actor.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const query = hierarchyAllowedDestinationsQuerySchema.parse({
      family: searchParams.get("family")
    });

    const nodes = await fetchAllowedHierarchyDestinationNodes(query.family);
    return NextResponse.json({ nodes });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid query", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Only admins can create hierarchy destinations from intake." }, { status: 403 });

    const payload = createHierarchyDestinationSchema.parse(await request.json());
    const node = await createHierarchyDestinationNode({
      family: payload.family,
      parentId: payload.parentId,
      nodeKind: payload.nodeKind,
      nodeKey: payload.nodeKey,
      name: payload.name,
      sortOrder: payload.sortOrder,
      creationMode: payload.creationMode,
      metadata: payload.metadata,
      actorUserId: actor.userId
    });

    await writeAuditLog({
      user_id: actor.userId,
      action: "hierarchy_destination_create",
      record_type: "hierarchy_nodes",
      record_id: node.id,
      before_json: {},
      after_json: node as unknown as Record<string, unknown>,
      source: "hierarchy"
    });

    return NextResponse.json({ ok: true, node });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    const message = error instanceof Error ? error.message : "Unknown error";
    const normalized = message.toLowerCase();
    if (normalized.includes("archived") || normalized.includes("parent") || normalized.includes("root") || normalized.includes("family")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (normalized.includes("duplicate") || normalized.includes("unique")) {
      return NextResponse.json({ error: "A destination with that key already exists under the selected parent." }, { status: 409 });
    }
    if (normalized.includes("row-level security") || normalized.includes("permission")) {
      return NextResponse.json({ error: "Destination creation is not permitted for this user/session." }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
