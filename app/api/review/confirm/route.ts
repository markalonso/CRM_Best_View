import { NextRequest, NextResponse } from "next/server";
import { confirmIntakeSession } from "@/services/intake/confirm-intake.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { writeAuditLog } from "@/services/audit/audit-log.service";

type ReviewType = "sale" | "rent" | "buyer" | "client" | "other";
type Mode = "create_new" | "update_existing";
type MergeMode = "keep_existing" | "replace_with_new" | "append";

type Payload = {
  intakeSessionId: string;
  type: ReviewType;
  mode: Mode;
  selectedRecordId?: string;
  extractedData: Record<string, unknown>;
  mergeDecisions: Record<string, MergeMode>;
};

export async function POST(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "agent")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const payload = (await request.json()) as Payload;

    if (!payload.intakeSessionId || !payload.type || payload.type === "other") {
      return NextResponse.json({ error: "Unsupported type or missing intakeSessionId" }, { status: 400 });
    }

    const result = await confirmIntakeSession(payload.intakeSessionId, payload.mode, payload.selectedRecordId, {
      type: payload.type,
      extracted_data: payload.extractedData || {},
      merge_decisions: payload.mergeDecisions || {}
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
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("already confirmed")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
