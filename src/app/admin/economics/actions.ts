"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createDatabaseServerClient } from "@/lib/database/server";
import type { EconomicsSaveState } from "@/lib/economics-input";
import { validateEconomicsFormData } from "@/lib/economics-validation";
import { logOperationalError, logOperationalEvent } from "@/lib/observability";

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

  const database = createDatabaseServerClient();

  if (!database) {
    return { status: "error", message: "База данных не подключена." };
  }

  const validation = validateEconomicsFormData(formData);
  if (!validation.success) {
    return {
      status: "error",
      message: "Проверьте выделенные поля.",
      fieldErrors: validation.fieldErrors
    };
  }

  try {
    const { error } = await database.from("economics_settings").upsert(
      {
        id: "main",
        ...validation.values
      },
      { onConflict: "id" }
    );

    if (error) {
      logOperationalError("economics.settings_save_failed", { reason: "database_write" });
      return { status: "error", message: "Не удалось сохранить вводные. Попробуйте ещё раз." };
    }

    revalidatePath("/admin/economics");
    logOperationalEvent("economics.settings_saved");

    return {
      status: "success",
      message: "Вводные сохранены.",
      values: validation.values
    };
  } catch {
    logOperationalError("economics.settings_save_failed", { reason: "unexpected" });
    return { status: "error", message: "Не удалось сохранить вводные. Попробуйте ещё раз." };
  }
}
