import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/services/audit/audit-log.service";
import { requireAdminActor } from "@/services/auth/role.service";
import { setRecordsArchiveState } from "@/services/records/record-archive.service";

const payloadSchema = z.object({
  type: z.enum(["sale", "rent", "buyer", "client"]),
  recordIds: z.array(z.string().uuid()).min(1).max(200),
  archived: z.boolean()
});

const recordTypeByGridType = {
  sale: "properties_sale",
  rent: "properties_rent",
  buyer: "buyers",
  client: "clients"
} as const;

export async function POST(request: NextRequest) {
  try {
    const { actor, errorResponse } = await requireAdminActor(request);
    if (errorResponse) return errorResponse;
    if (!actor.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const payload = payloadSchema.parse(await request.json());
    const result = await setRecordsArchiveState({
      type: payload.type,
      recordIds: payload.recordIds,
      archived: payload.archived,
      actorUserId: actor.userId
    });

    await Promise.all(
      result.updatedRecordIds.map((recordId) =>
        writeAuditLog({
          user_id: actor.userId,
          action: payload.archived ? "record_archive" : "record_unarchive",
          record_type: recordTypeByGridType[payload.type],
          record_id: recordId,
          before_json: {},
          after_json: {
            is_archived: payload.archived,
            archived_by: payload.archived ? actor.userId : null
          },
          source: "grid"
        })
      )
    );

    return NextResponse.json({
      ok: true,
      archiveState: result.archiveState,
      updatedRecordIds: result.updatedRecordIds
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid archive payload", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.toLowerCase().includes("no matching records")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
