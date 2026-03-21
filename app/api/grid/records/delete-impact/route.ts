import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestActor, hasRole } from "@/services/auth/role.service";
import { fetchRecordDeleteImpact } from "@/services/records/record-delete.service";

const payloadSchema = z.object({
  type: z.enum(["sale", "rent", "buyer", "client"]),
  recordIds: z.array(z.string().uuid()).min(1).max(200)
});

export async function POST(request: NextRequest) {
  try {
    const actor = await getRequestActor(request);
    if (!hasRole(actor.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const payload = payloadSchema.parse(await request.json());
    const impact = await fetchRecordDeleteImpact({
      type: payload.type,
      recordIds: payload.recordIds
    });

    return NextResponse.json({ ok: true, impact });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid delete impact payload", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.toLowerCase().includes("no matching records")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
