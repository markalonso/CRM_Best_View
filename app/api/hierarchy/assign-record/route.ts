import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/services/audit/audit-log.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { assignRecordToHierarchyNode } from "@/services/hierarchy/hierarchy.service";
import { assignRecordToNodeSchema } from "@/services/hierarchy/hierarchy.schemas";

export async function POST(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "agent")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const payload = assignRecordToNodeSchema.parse(await request.json());
    const link = await assignRecordToHierarchyNode({
      family: payload.family,
      recordId: payload.recordId,
      nodeId: payload.nodeId,
      actorUserId: actor.userId
    });

    await writeAuditLog({
      user_id: actor.userId,
      action: "assign_record_hierarchy",
      record_type: payload.family,
      record_id: payload.recordId,
      before_json: {},
      after_json: { node_id: payload.nodeId, link_id: link.id || null },
      source: "hierarchy"
    });

    return NextResponse.json({ ok: true, link });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
