import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function writeAuditLog(params: {
  action: string;
  actorType?: "admin" | "customer" | "system";
  actorId?: string | null;
  actorRefHash?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  sourcePath?: string | null;
  userAgent?: string | null;
}) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return;
  }

  await supabase.from("audit_logs").insert({
    action: params.action,
    actor_id: params.actorId ?? null,
    actor_ref_hash: params.actorRefHash ?? null,
    actor_type: params.actorType ?? "system",
    entity_id: params.entityId ?? null,
    entity_type: params.entityType ?? null,
    metadata: params.metadata ?? {},
    source_path: params.sourcePath ?? null,
    user_agent_short: params.userAgent ?? null
  });
}
