import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/services/auth/role.service";

export async function POST(request: NextRequest) {
  const { errorResponse } = await requireAdminActor(request);
  if (errorResponse) return errorResponse;
  return NextResponse.json({
    status: "not_implemented",
    message: "Extraction pipeline will be added in intake module business layer."
  });
}
