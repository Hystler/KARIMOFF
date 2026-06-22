"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { economicsKeys, normalizeEconomicsRow } from "@/lib/economics";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EconomicsSaveState = {
  message: string | null;
  status: "idle" | "success" | "error";
};

export const initialEconomicsSaveState: EconomicsSaveState = {
  message: null,
  status: "idle"
};

async function requireAdmin() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }
}

export async function saveEconomicsSettingsAction(
  _state: EconomicsSaveState,
  formData: FormData
): Promise<EconomicsSaveState> {
  await requireAdmin();

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { status: "error", message: "Supabase не подключён." };
  }

  const values = normalizeEconomicsRow(
    Object.fromEntries(
      economicsKeys.map((key) => {
        const raw = String(formData.get(key) || "0").replace(",", ".");
        return [key, Number(raw) || 0];
      })
    )
  );

  const { error } = await supabase.from("economics_settings").upsert(
    {
      id: "main",
      ...values
    },
    { onConflict: "id" }
  );

  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/admin/economics");

  return { status: "success", message: "Сохранено." };
}

