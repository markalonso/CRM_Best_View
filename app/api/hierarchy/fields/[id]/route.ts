import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/services/audit/audit-log.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { deleteFieldDefinition, fetchFieldDeletionImpact } from "@/services/hierarchy/hierarchy.service";
import { hierarchyNodeIdSchema } from "@/services/hierarchy/hierarchy.schemas";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await getRequestActor(_request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const fieldId = z.string().uuid().parse(params.id);
    const result = await fetchFieldDeletionImpact(fieldId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid field id", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const fieldId = z.string().uuid().parse(params.id);
    const { searchParams } = new URL(request.url);
    const nodeId = searchParams.get("nodeId") ? hierarchyNodeIdSchema.parse(searchParams.get("nodeId")) : undefined;

    const result = await deleteFieldDefinition({
      fieldId,
      nodeId
    });

    await writeAuditLog({
      user_id: actor.userId,
      action: result.action === "override_deleted" ? "field_override_delete" : "field_definition_delete",
      record_type: "field_definitions",
      record_id: fieldId,
      before_json: {
        field_key: result.field.field_key,
        family: result.field.family,
        node_id: nodeId || null
      },
      after_json: {
        action: result.action,
        impact: "impact" in result ? result.impact : null
      },
      source: "hierarchy"
    });

    return NextResponse.json({ ok: true, fieldId, action: result.action, impact: "impact" in result ? result.impact : null });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid delete request", issues: error.issues }, { status: 400 });
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.toLowerCase().includes("cannot") || message.toLowerCase().includes("no override")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
