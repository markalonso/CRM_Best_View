import { z } from "zod";

const requiredEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1)
});

const optionalEnvSchema = z.object({
  INTEGRATION_KEY: z.string().min(1).optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional()
});

export type RuntimeEnv = z.infer<typeof requiredEnvSchema> & z.infer<typeof optionalEnvSchema>;

function rawEnv() {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    INTEGRATION_KEY: process.env.INTEGRATION_KEY,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
    GOOGLE_SHEETS_SPREADSHEET_ID: process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  };
}

export function getEnv(): RuntimeEnv {
  const raw = rawEnv();
  const required = requiredEnvSchema.parse(raw);
  const optional = optionalEnvSchema.parse(raw);
  return { ...required, ...optional };
}

export function getEnvSafe() {
  try {
    return { ok: true as const, env: getEnv() };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false as const,
        message: `Server misconfigured: missing ${error.issues
          .map((issue) => issue.path.join("."))
          .filter(Boolean)
          .join(", ")}`
      };
    }
    return { ok: false as const, message: "Server misconfigured: invalid environment" };
  }
}

export function getIntegrationKey() {
  const value = rawEnv().INTEGRATION_KEY;
  return value && value.trim() ? value : null;
}
