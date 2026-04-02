import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { confirmIntakeSession } from "@/services/intake/confirm-intake.service";
import { requireAdminActor } from "@/services/auth/role.service";
import { writeAuditLog } from "@/services/audit/audit-log.service";

const payloadSchema = z.object({
  intakeSessionId: z.string().uuid(),
  type: z.enum(["sale", "rent", "buyer", "client", "other"]),
  mode: z.enum(["create_new", "update_existing"]),
  selectedRecordId: z.string().uuid().optional(),
  extractedData: z.record(z.string(), z.unknown()).default({}),
  mergeDecisions: z.record(z.string(), z.enum(["keep_existing", "replace_with_new", "append"])) .default({}),
  hierarchyNodeId: z.string().uuid().optional(),
  mediaFolderName: z.string().trim().max(120).optional(),
  customFieldValues: z.array(
    z.object({
      fieldKey: z.string().trim().min(1).max(100),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.string(), z.unknown()), z.null()])
    })
  ).default([])
});

export async function POST(request: NextRequest) {
  try {
    const { actor, errorResponse } = await requireAdminActor(request);
    if (errorResponse) return errorResponse;
    const payload = payloadSchema.parse(await request.json());

    if (!payload.intakeSessionId || !payload.type || payload.type === "other") {
      return NextResponse.json({ error: "Unsupported type or missing intakeSessionId" }, { status: 400 });
    }

    const result = await confirmIntakeSession(payload.intakeSessionId, payload.mode, payload.selectedRecordId, {
      type: payload.type,
      extracted_data: payload.extractedData || {},
      merge_decisions: payload.mergeDecisions || {},
      hierarchy_node_id: payload.hierarchyNodeId,
      media_folder_name: payload.mediaFolderName,
      custom_field_values: payload.customFieldValues || [],
      actor_user_id: actor.userId
    });

    await writeAuditLog({
      user_id: actor.userId,
      action: payload.mode === "create_new" ? "confirm_create" : "confirm_merge",
      record_type: result.recordType,
      record_id: result.recordId,
      before_json: {},
      after_json: { changedFields: result.changedFields, status: result.status, session_id: payload.intakeSessionId },
      source: "confirm"
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("already confirmed")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.toLowerCase().includes("hierarchy") || message.toLowerCase().includes("root node") || message.toLowerCase().includes("destination") || message.toLowerCase().includes("container-only") || message.toLowerCase().includes("archived") || message.toLowerCase().includes("media folder")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
