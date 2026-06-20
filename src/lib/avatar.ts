import "server-only";

import { defaultAvatar, avatarSchema, type AvatarConfig } from "@/lib/avatar-schema";
import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export function normalizeAvatar(row: Record<string, unknown> | null | undefined): AvatarConfig {
  const parsed = avatarSchema.safeParse({
    base: row?.base,
    eyes: row?.eyes,
    mouth: row?.mouth,
    accessory: row?.accessory,
    clothes: row?.clothes,
    background: row?.background
  });

  return parsed.success ? parsed.data : defaultAvatar;
}

export async function getCustomerAvatar(customerId: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      avatar: defaultAvatar,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase
    .from("customer_avatars")
    .select("base, eyes, mouth, accessory, clothes, background")
    .eq("customer_id", customerId)
    .maybeSingle();

  return {
    avatar: normalizeAvatar(data),
    notConfigured: false,
    error: formatMissingTableError(error?.message, "customer_avatars", "supabase/avatar.sql")
  };
}
