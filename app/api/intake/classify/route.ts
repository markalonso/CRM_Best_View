import { NextRequest, NextResponse } from "next/server";
import { classifyIntakeInput } from "@/services/api/intake-api.service";
import { requireAdminActor } from "@/services/auth/role.service";

export async function POST(request: NextRequest) {
  const { errorResponse } = await requireAdminActor(request);
  if (errorResponse) return errorResponse;
  const { rawText } = await request.json();
  const data = await classifyIntakeInput(rawText);
  return NextResponse.json(data);
}
