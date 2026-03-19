import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/services/audit/audit-log.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { moveHierarchyNode } from "@/services/hierarchy/hierarchy.service";
import { moveHierarchyNodeSchema } from "@/services/hierarchy/hierarchy.schemas";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const payload = moveHierarchyNodeSchema.parse(await request.json());
    const node = await moveHierarchyNode(params.id, payload.newParentId);

    await writeAuditLog({
      user_id: actor.userId,
      action: "hierarchy_node_move",
      record_type: "hierarchy_nodes",
      record_id: node.id,
      before_json: {},
      after_json: { new_parent_id: payload.newParentId, path_text: node.path_text },
      source: "hierarchy"
    });

    return NextResponse.json({ ok: true, node });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
