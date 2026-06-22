import "server-only";

import {
  avatarAssetTypes,
  avatarOptions,
  defaultAvatar,
  avatarSchema,
  type AvatarConfig,
  type AvatarOptions
} from "@/lib/avatar-schema";
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

export async function getAvatarAssets() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      options: avatarOptions,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase
    .from("avatar_assets")
    .select("type, name, value, image_url, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error || !data?.length) {
    return {
      options: avatarOptions,
      notConfigured: false,
      error: formatMissingTableError(error?.message, "avatar_assets", "supabase/avatar-assets.sql")
    };
  }

  const options = avatarAssetTypes.reduce((acc, type) => {
    acc[type] = [];
    return acc;
  }, {} as AvatarOptions);

  data.forEach((asset) => {
    const type = String(asset.type);

    if (!avatarAssetTypes.includes(type as (typeof avatarAssetTypes)[number])) {
      return;
    }

    options[type as keyof AvatarOptions].push({
      image_url: typeof asset.image_url === "string" ? asset.image_url : null,
      label: String(asset.name ?? asset.value),
      value: String(asset.value)
    });
  });

  avatarAssetTypes.forEach((type) => {
    if (options[type].length === 0) {
      options[type] = avatarOptions[type];
    }
  });

  return {
    options,
    notConfigured: false,
    error: null as string | null
  };
}
