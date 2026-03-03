import { createSupabaseClient } from "@/services/supabase/client";

type AuditInput = {
  user_id?: string | null;
  action: string;
  record_type: string;
  record_id: string;
  before_json?: Record<string, unknown> | null;
  after_json?: Record<string, unknown> | null;
  source?: string;
};

export async function writeAuditLog(input: AuditInput) {
  const supabase = createSupabaseClient();
  const { error } = await supabase.from("audit_logs").insert({
    user_id: input.user_id || null,
    action: input.action,
    record_type: input.record_type,
    record_id: input.record_id,
    before_json: input.before_json || {},
    after_json: input.after_json || {},
    source: input.source || "app"
  });

  if (error) throw new Error(error.message);
}
