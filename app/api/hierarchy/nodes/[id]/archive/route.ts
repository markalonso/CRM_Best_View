import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/services/audit/audit-log.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { archiveHierarchyNode, fetchHierarchyNodeDetails } from "@/services/hierarchy/hierarchy.service";
import { archiveHierarchyNodeSchema, hierarchyNodeIdSchema } from "@/services/hierarchy/hierarchy.schemas";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const nodeId = hierarchyNodeIdSchema.parse(params.id);
    const before = await fetchHierarchyNodeDetails(nodeId);
    const payload = archiveHierarchyNodeSchema.parse(await request.json());
    const node = await archiveHierarchyNode(nodeId, payload.archived);

    await writeAuditLog({
      user_id: actor.userId,
      action: payload.archived ? "hierarchy_node_archive" : "hierarchy_node_restore",
      record_type: "hierarchy_nodes",
      record_id: node.id,
      before_json: before.node as unknown as Record<string, unknown>,
      after_json: node as unknown as Record<string, unknown>,
      source: "hierarchy"
    });

    return NextResponse.json({ ok: true, node });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: error.issues }, { status: 400 });
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.toLowerCase().includes("archive") || message.toLowerCase().includes("linked") || message.toLowerCase().includes("empty nodes")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
