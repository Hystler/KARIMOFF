"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { productIngredientFormSchema, type ProductIngredientFormInput } from "@/lib/ingredient-schema";
import { createDatabaseServerClient } from "@/lib/database/server";

async function requireAdmin() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }
}

function getDatabaseOrRedirect(productId: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    redirect(`/admin/products/${productId}/edit?error=database`);
  }

  return database;
}

function revalidateProductComposition(productId: string) {
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin/economics");
}

function toCompositionPayload(data: ProductIngredientFormInput) {
  return {
    ingredient_id: data.ingredient_id,
    quantity: data.quantity,
    unit: data.unit,
    sort_order: data.sort_order,
    is_removable: data.is_removable,
    is_extra_available: data.is_extra_available,
    extra_quantity: data.extra_quantity,
    extra_price: data.extra_price,
    max_extra_quantity: data.max_extra_quantity,
    preparation_step: data.preparation_step || null,
    preparation_note: data.preparation_note || null,
    preparation_image_url: data.preparation_image_url || null,
    station: data.station || null,
    preparation_time_seconds: data.preparation_time_seconds || null
  };
}

function compositionSaveError(message: string) {
  if (message.includes("product_ingredients_station_check")) {
    return "Выберите допустимую кухонную станцию";
  }
  return "Не удалось сохранить строку состава";
}

export async function addProductIngredientAction(formData: FormData) {
  await requireAdmin();

  const parsed = productIngredientFormSchema.safeParse({
    product_id: formData.get("product_id"),
    ingredient_id: formData.get("ingredient_id"),
    quantity: formData.get("quantity"),
    unit: formData.get("unit"),
    sort_order: formData.get("sort_order") || 100,
    is_removable: formData.get("is_removable") === "on",
    is_extra_available: formData.get("is_extra_available") === "on",
    extra_quantity: formData.get("extra_quantity") || 0,
    extra_price: formData.get("extra_price") || 0,
    max_extra_quantity: formData.get("max_extra_quantity") || 1,
    preparation_step: formData.get("preparation_step") || "",
    preparation_note: formData.get("preparation_note") || "",
    preparation_image_url: formData.get("preparation_image_url") || "",
    station: formData.get("station") || "",
    preparation_time_seconds: formData.get("preparation_time_seconds") || 0
  });

  const productId = String(formData.get("product_id") || "");

  if (!parsed.success) {
    redirect(`/admin/products/${productId}/edit?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте состав")}`);
  }

  const database = getDatabaseOrRedirect(parsed.data.product_id);
  const { error } = await database.from("product_ingredients").insert({
    product_id: parsed.data.product_id,
    ...toCompositionPayload(parsed.data)
  });

  if (error) {
    redirect(`/admin/products/${parsed.data.product_id}/edit?error=${encodeURIComponent(compositionSaveError(error.message))}`);
  }

  revalidateProductComposition(parsed.data.product_id);
  redirect(`/admin/products/${parsed.data.product_id}/edit?saved=composition`);
}

export async function updateProductIngredientAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") || "");
  const productId = String(formData.get("product_id") || "");
  const parsed = productIngredientFormSchema.safeParse({
    product_id: formData.get("product_id"),
    ingredient_id: formData.get("ingredient_id"),
    quantity: formData.get("quantity"),
    unit: formData.get("unit"),
    sort_order: formData.get("sort_order") || 100,
    is_removable: formData.get("is_removable") === "on",
    is_extra_available: formData.get("is_extra_available") === "on",
    extra_quantity: formData.get("extra_quantity") || 0,
    extra_price: formData.get("extra_price") || 0,
    max_extra_quantity: formData.get("max_extra_quantity") || 1,
    preparation_step: formData.get("preparation_step") || "",
    preparation_note: formData.get("preparation_note") || "",
    preparation_image_url: formData.get("preparation_image_url") || "",
    station: formData.get("station") || "",
    preparation_time_seconds: formData.get("preparation_time_seconds") || 0
  });

  if (!id || !parsed.success) {
    redirect(`/admin/products/${productId}/edit?error=${encodeURIComponent(parsed.success ? "Не найдена строка состава" : parsed.error.issues[0]?.message ?? "Проверьте состав")}`);
  }

  const database = getDatabaseOrRedirect(parsed.data.product_id);
  const { error } = await database
    .from("product_ingredients")
    .update(toCompositionPayload(parsed.data))
    .eq("id", id);

  if (error) {
    redirect(`/admin/products/${parsed.data.product_id}/edit?error=${encodeURIComponent(compositionSaveError(error.message))}`);
  }

  revalidateProductComposition(parsed.data.product_id);
  redirect(`/admin/products/${parsed.data.product_id}/edit?saved=composition`);
}

export async function deleteProductIngredientAction(formData: FormData) {
  await requireAdmin();

  const id = String(formData.get("id") || "");
  const productId = String(formData.get("product_id") || "");

  if (!id || !productId) {
    redirect(`/admin/products/${productId}/edit?error=missing_composition_id`);
  }

  const database = getDatabaseOrRedirect(productId);
  const { error } = await database.from("product_ingredients").delete().eq("id", id);

  if (error) {
    redirect(`/admin/products/${productId}/edit?error=${encodeURIComponent(error.message)}`);
  }

  revalidateProductComposition(productId);
  redirect(`/admin/products/${productId}/edit?saved=composition`);
}
