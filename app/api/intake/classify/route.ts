import { NextRequest, NextResponse } from "next/server";
import { classifyIntakeInput } from "@/services/api/intake-api.service";

export async function POST(request: NextRequest) {
  const { rawText } = await request.json();
  const data = await classifyIntakeInput(rawText);
  return NextResponse.json(data);
}
