import "server-only";
import OpenAI from "openai";
import { getEnvSafe } from "@/lib/env";

let cachedOpenAI: OpenAI | null = null;

export function getOpenAIClient() {
  if (cachedOpenAI) return cachedOpenAI;

  const resolved = getEnvSafe();
  if (!resolved.ok) {
    throw new Error("Server misconfigured: missing OPENAI_API_KEY");
  }

  cachedOpenAI = new OpenAI({ apiKey: resolved.env.OPENAI_API_KEY });
  return cachedOpenAI;
}
