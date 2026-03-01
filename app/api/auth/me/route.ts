import { NextRequest, NextResponse } from "next/server";
import { getRequestActor } from "@/services/auth/role.service";

export async function GET(request: NextRequest) {
  const actor = await getRequestActor(request);
  return NextResponse.json({ actor });
}
