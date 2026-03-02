import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    status: "not_implemented",
    message: "Extraction pipeline will be added in intake module business layer."
  });
}
