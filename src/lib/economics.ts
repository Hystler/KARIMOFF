import "server-only";

import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EconomicsValues = {
  acquiring_percent: number;
  average_check: number;
  equipment: number;
  food_cost_percent: number;
  furniture: number;
  launch_marketing: number;
  marketing: number;
  misc_percent: number;
  orders_per_day: number;
  other_capex: number;
  other_expenses: number;
  payroll: number;
  renovation: number;
  rent: number;
  royalty_percent: number;
  tax_percent: number;
  utilities: number;
  working_days_per_month: number;
};

export const defaultEconomicsValues: EconomicsValues = {
  average_check: 430,
  orders_per_day: 120,
  working_days_per_month: 30,
  food_cost_percent: 35,
  rent: 180000,
  payroll: 450000,
  utilities: 60000,
  marketing: 80000,
  other_expenses: 50000,
  equipment: 2200000,
  renovation: 1500000,
  furniture: 500000,
  launch_marketing: 300000,
  other_capex: 200000,
  royalty_percent: 5,
  acquiring_percent: 2.2,
  tax_percent: 6,
  misc_percent: 2
};

export const economicsKeys = Object.keys(defaultEconomicsValues) as Array<keyof EconomicsValues>;

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
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      settings: defaultEconomicsValues,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase.from("economics_settings").select("*").eq("id", "main").maybeSingle();

  return {
    settings: normalizeEconomicsRow(data),
    notConfigured: false,
    error: formatMissingTableError(error?.message, "economics_settings", "supabase/economics-settings.sql")
  };
}

