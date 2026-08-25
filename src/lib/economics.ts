import "server-only";

import { formatMissingTableError } from "@/lib/database/errors";
import { createDatabaseServerClient } from "@/lib/database/server";
import {
  defaultEconomicsValues,
  economicsKeys,
  type EconomicsValues
} from "@/lib/economics-values";

export { defaultEconomicsValues, economicsKeys } from "@/lib/economics-values";
export type { EconomicsValues } from "@/lib/economics-values";

export function normalizeEconomicsRow(row: Record<string, unknown> | null | undefined): EconomicsValues {
  if (!row) {
    return defaultEconomicsValues;
  }

  return economicsKeys.reduce((acc, key) => {
    acc[key] = Number(row[key] ?? defaultEconomicsValues[key]);
    return acc;
  }, {} as EconomicsValues);
}

export async function getAdminEconomicsSettings() {
  const database = createDatabaseServerClient();

  if (!database) {
    return {
      settings: defaultEconomicsValues,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await database.from("economics_settings").select("*").eq("id", "main").maybeSingle();

  return {
    settings: normalizeEconomicsRow(data),
    notConfigured: false,
    error: formatMissingTableError(error?.message, "economics_settings")
  };
}
