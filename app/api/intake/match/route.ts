import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    status: "not_implemented",
    message: "Entity matching will be implemented in modules/search business layer."
  });
}
