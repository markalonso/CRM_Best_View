import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/services/audit/audit-log.service";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { deleteMediaItem } from "@/services/media/media-delete.service";

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await getRequestActor(_request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const mediaId = z.string().uuid().parse(params.id);
    const result = await deleteMediaItem({ mediaId });

    await writeAuditLog({
      user_id: actor.userId,
      action: "media_delete",
      record_type: "media",
      record_id: mediaId,
      before_json: result.media as unknown as Record<string, unknown>,
      after_json: { storageWarnings: result.storageWarnings },
      source: "media"
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid media id", issues: error.issues }, { status: 400 });
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
