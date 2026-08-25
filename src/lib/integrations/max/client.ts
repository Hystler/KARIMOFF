import "server-only";

import { z } from "zod";
import { getMaxAuthConfig } from "@/lib/auth/social/config";

export const MAX_API_BASE_URL = "https://platform-api2.max.ru";

const botProfileSchema = z.object({
  user_id: z.number().or(z.string()),
  name: z.string().optional(),
  username: z.string().optional()
}).passthrough();

export async function getMaxBotProfile() {
  const config = getMaxAuthConfig();
  if (!config) throw new Error("MAX integration is not configured.");
  const response = await fetch(`${MAX_API_BASE_URL}/me`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: config.botToken
    },
    method: "GET",
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`MAX API request failed with status ${response.status}.`);
  return botProfileSchema.parse(await response.json());
}
