import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/services/audit/audit-log.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { createHierarchyNode } from "@/services/hierarchy/hierarchy.service";
import { createHierarchyNodeSchema } from "@/services/hierarchy/hierarchy.schemas";

export async function POST(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const payload = createHierarchyNodeSchema.parse(await request.json());
    const node = await createHierarchyNode({
      family: payload.family,
      parentId: payload.parentId,
      nodeKind: payload.nodeKind,
      nodeKey: payload.nodeKey,
      name: payload.name,
      sortOrder: payload.sortOrder,
      allowRecordAssignment: payload.allowRecordAssignment,
      mutationMode: payload.mutationMode,
      canHaveChildren: payload.canHaveChildren,
      canContainRecords: payload.canContainRecords,
      isActive: payload.isActive,
      metadata: payload.metadata,
      actorUserId: actor.userId
    });

    await writeAuditLog({
      user_id: actor.userId,
      action: "hierarchy_node_create",
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
    if (message.toLowerCase().includes("parent") || message.toLowerCase().includes("root") || message.toLowerCase().includes("cannot") || message.toLowerCase().includes("archived") || message.toLowerCase().includes("media hierarchy")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
