"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { createDatabaseServerClient } from "@/lib/database/server";
import {
  productionOverheadSchema,
  productionRecipeSchema,
  productionRunSchema
} from "@/lib/production-schema";

async function requireProductionStaff() {
  const staff = await getCurrentStaff();
  if (!staff || staff.role === "cook") redirect("/admin/login");
  return staff;
}

function getDatabase() {
  const database = createDatabaseServerClient();
  if (!database) redirect("/admin/production?error=database");
  return database;
}

function parseJsonArray(value: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function productionError(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  return error.code === "P0001" ? error.message : fallback;
}

function revalidateProduction() {
  revalidatePath("/admin");
  revalidatePath("/admin/production");
  revalidatePath("/admin/ingredients");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin/products");
  revalidatePath("/admin/economics");
}

export async function saveProductionRecipeAction(formData: FormData) {
  const staff = await requireProductionStaff();
  const parsed = productionRecipeSchema.safeParse({
    id: formData.get("id") || null,
    name: formData.get("name"),
    output_ingredient_id: formData.get("output_ingredient_id"),
    category: formData.get("category") || undefined,
    output_quantity: formData.get("output_quantity"),
    output_unit: formData.get("output_unit"),
    batch_duration_minutes: formData.get("batch_duration_minutes"),
    planned_batches_per_month: formData.get("planned_batches_per_month"),
    sale_price_per_output_unit: formData.get("sale_price_per_output_unit"),
    notes: formData.get("notes") || undefined,
    is_active: formData.get("is_active") === "on",
    sort_order: formData.get("sort_order") || 100,
    components: parseJsonArray(formData.get("components_json")),
    expenses: parseJsonArray(formData.get("expenses_json"))
  });

  const returnPath = parsed.success && parsed.data.id
    ? `/admin/production/${parsed.data.id}/edit`
    : "/admin/production/new";
  if (!parsed.success) {
    redirect(`${returnPath}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте карту")}`);
  }

  const database = getDatabase();
  const { data, error } = await database.rpc("save_production_recipe_atomic", {
    p_batch_duration_minutes: parsed.data.batch_duration_minutes,
    p_category: parsed.data.category || null,
    p_components: parsed.data.components,
    p_expenses: parsed.data.expenses,
    p_is_active: parsed.data.is_active,
    p_name: parsed.data.name,
    p_notes: parsed.data.notes || null,
    p_output_ingredient_id: parsed.data.output_ingredient_id,
    p_output_quantity: parsed.data.output_quantity,
    p_output_unit: parsed.data.output_unit,
    p_planned_batches_per_month: parsed.data.planned_batches_per_month,
    p_recipe_id: parsed.data.id || null,
    p_sale_price_per_output_unit: parsed.data.sale_price_per_output_unit,
    p_sort_order: parsed.data.sort_order
  });

  if (error) {
    redirect(`${returnPath}?error=${encodeURIComponent(productionError(error, "Не удалось сохранить производственную карту."))}`);
  }

  const recipeId = String(data || parsed.data.id || "");
  await writeAuditLog({
    action: parsed.data.id ? "production.recipe_update" : "production.recipe_create",
    actorId: staff.id,
    actorType: "staff",
    entityId: recipeId || null,
    entityType: "production_recipe",
    metadata: {
      component_count: parsed.data.components.length,
      expense_count: parsed.data.expenses.length,
      output_ingredient_id: parsed.data.output_ingredient_id
    },
    sourcePath: returnPath
  });
  revalidateProduction();
  redirect("/admin/production?saved=recipe");
}

export async function saveProductionOverheadAction(formData: FormData) {
  const staff = await requireProductionStaff();
  const parsed = productionOverheadSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    category: formData.get("category"),
    quantity: formData.get("quantity"),
    amount_per_unit: formData.get("amount_per_unit"),
    comment: formData.get("comment") || undefined,
    is_active: formData.get("is_active") === "on",
    sort_order: formData.get("sort_order") || 100
  });
  if (!parsed.success) {
    redirect(`/admin/production?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте расход")}`);
  }

  const database = getDatabase();
  const payload = {
    amount_per_unit: parsed.data.amount_per_unit,
    category: parsed.data.category,
    comment: parsed.data.comment || null,
    is_active: parsed.data.is_active,
    name: parsed.data.name,
    quantity: parsed.data.quantity,
    sort_order: parsed.data.sort_order
  };
  const result = parsed.data.id
    ? await database.from("production_overheads").update(payload).eq("id", parsed.data.id)
    : await database.from("production_overheads").insert(payload).select("id").single();

  if (result.error) {
    redirect(`/admin/production?error=${encodeURIComponent("Не удалось сохранить ежемесячный расход.")}`);
  }

  await writeAuditLog({
    action: parsed.data.id ? "production.overhead_update" : "production.overhead_create",
    actorId: staff.id,
    actorType: "staff",
    entityId: parsed.data.id || (result.data?.id ? String(result.data.id) : null),
    entityType: "production_overhead",
    metadata: { category: parsed.data.category, monthly_amount: parsed.data.quantity * parsed.data.amount_per_unit },
    sourcePath: "/admin/production"
  });
  revalidateProduction();
  redirect("/admin/production?saved=overhead");
}

export async function deleteProductionOverheadAction(formData: FormData) {
  const staff = await requireProductionStaff();
  const id = String(formData.get("id") || "");
  if (!id) redirect("/admin/production?error=missing_overhead");
  const database = getDatabase();
  const { error } = await database.from("production_overheads").delete().eq("id", id);
  if (error) redirect(`/admin/production?error=${encodeURIComponent("Не удалось удалить расход.")}`);
  await writeAuditLog({
    action: "production.overhead_delete",
    actorId: staff.id,
    actorType: "staff",
    entityId: id,
    entityType: "production_overhead",
    sourcePath: "/admin/production"
  });
  revalidateProduction();
  redirect("/admin/production?saved=overhead_deleted");
}

export async function completeProductionRunAction(formData: FormData) {
  const staff = await requireProductionStaff();
  const parsed = productionRunSchema.safeParse({
    recipe_id: formData.get("recipe_id"),
    batch_count: formData.get("batch_count"),
    output_quantity: formData.get("output_quantity"),
    notes: formData.get("notes") || undefined
  });
  if (!parsed.success) {
    redirect(`/admin/production?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте выпуск")}`);
  }

  const database = getDatabase();
  const { error } = await database.rpc("complete_production_run_atomic", {
    p_batch_count: parsed.data.batch_count,
    p_created_by: staff.name,
    p_notes: parsed.data.notes || null,
    p_output_quantity: parsed.data.output_quantity,
    p_recipe_id: parsed.data.recipe_id
  });
  if (error) {
    redirect(`/admin/production?error=${encodeURIComponent(productionError(error, "Не удалось зафиксировать выпуск."))}`);
  }
  revalidateProduction();
  redirect("/admin/production?saved=run");
}
