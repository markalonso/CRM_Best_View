import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    status: "not_implemented",
    message: "Finalize flow will be implemented in modules/intake business layer."
  });
}
