import "server-only";

import { createHmac } from "node:crypto";
import { createDatabaseServerClient } from "@/lib/database/server";

type RateLimitResult = {
  allowed?: boolean;
  retry_after_seconds?: number;
};

const presets = {
  admin_login: { lockSeconds: 1800, maxAttempts: 5, windowSeconds: 900 },
  customer_login: { lockSeconds: 900, maxAttempts: 5, windowSeconds: 900 },
  customer_register: { lockSeconds: 900, maxAttempts: 5, windowSeconds: 900 },
  social_oauth: { lockSeconds: 900, maxAttempts: 20, windowSeconds: 600 },
  send_code: { lockSeconds: 600, maxAttempts: 3, windowSeconds: 600 },
  verify_code: { lockSeconds: 900, maxAttempts: 5, windowSeconds: 900 }
} as const;

export type RateLimitBucket = keyof typeof presets;

function keyHash(identifier: string) {
  const secret = process.env.AUTH_RATE_LIMIT_SECRET || process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("Auth rate-limit secret is not configured.");
  }

  return createHmac("sha256", secret).update(identifier.trim().toLowerCase()).digest("hex");
}

export async function checkAuthRateLimit(bucket: RateLimitBucket, identifier: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    return { allowed: false, message: "Сервис авторизации временно недоступен." };
  }

  const preset = presets[bucket];
  const hash = keyHash(identifier);
  const { data, error } = await database.rpc("auth_rate_limit_check", {
    p_bucket: bucket,
    p_key_hash: hash,
    p_window_seconds: preset.windowSeconds
  });

  if (error) {
    return { allowed: false, message: "Не удалось проверить лимит входа." };
  }

  const result = (data ?? {}) as RateLimitResult;
  const retry = Number(result.retry_after_seconds ?? 0);

  return result.allowed === false
    ? { allowed: false, message: `Слишком много попыток. Повторите через ${Math.max(1, Math.ceil(retry / 60))} мин.` }
    : { allowed: true, hash };
}

export async function recordAuthFailure(bucket: RateLimitBucket, identifier: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    return;
  }

  const preset = presets[bucket];
  await database.rpc("auth_rate_limit_failure", {
    p_bucket: bucket,
    p_key_hash: keyHash(identifier),
    p_lock_seconds: preset.lockSeconds,
    p_max_attempts: preset.maxAttempts,
    p_window_seconds: preset.windowSeconds
  });
}

export async function clearAuthFailures(bucket: RateLimitBucket, identifier: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    return;
  }

  await database.rpc("auth_rate_limit_clear", {
    p_bucket: bucket,
    p_key_hash: keyHash(identifier)
  });
}
