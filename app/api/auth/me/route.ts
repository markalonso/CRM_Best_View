import { NextRequest, NextResponse } from "next/server";
import { getRequestActor } from "@/services/auth/role.service";

export async function GET(request: NextRequest) {
  const actor = await getRequestActor(request);
  if (!actor.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ actor });
}
