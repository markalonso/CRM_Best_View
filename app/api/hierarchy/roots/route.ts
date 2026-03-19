import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/services/audit/audit-log.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { ensureHierarchyFamilyRoot } from "@/services/hierarchy/hierarchy.service";
import { ensureHierarchyRootSchema } from "@/services/hierarchy/hierarchy.schemas";

export async function POST(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const payload = ensureHierarchyRootSchema.parse(await request.json());
    const node = await ensureHierarchyFamilyRoot({
      family: payload.family,
      actorUserId: actor.userId
    });

    await writeAuditLog({
      user_id: actor.userId,
      action: "hierarchy_root_ensure",
      record_type: "hierarchy_nodes",
      record_id: node.id,
      before_json: {},
      after_json: node as unknown as Record<string, unknown>,
      source: "hierarchy"
    });

    return NextResponse.json({ ok: true, node });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
