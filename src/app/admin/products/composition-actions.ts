"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { productIngredientFormSchema } from "@/lib/ingredient-schema";
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
    max_extra_quantity: formData.get("max_extra_quantity") || 1
  });

  const productId = String(formData.get("product_id") || "");

  if (!parsed.success) {
    redirect(`/admin/products/${productId}/edit?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте состав")}`);
  }

  const database = getDatabaseOrRedirect(parsed.data.product_id);
  const { error } = await database.from("product_ingredients").insert(parsed.data);

  if (error) {
    redirect(`/admin/products/${parsed.data.product_id}/edit?error=${encodeURIComponent(error.message)}`);
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
    max_extra_quantity: formData.get("max_extra_quantity") || 1
  });

  if (!id || !parsed.success) {
    redirect(`/admin/products/${productId}/edit?error=${encodeURIComponent(parsed.success ? "Не найдена строка состава" : parsed.error.issues[0]?.message ?? "Проверьте состав")}`);
  }

  const database = getDatabaseOrRedirect(parsed.data.product_id);
  const { error } = await database
    .from("product_ingredients")
    .update({
      ingredient_id: parsed.data.ingredient_id,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit,
      sort_order: parsed.data.sort_order,
      is_removable: parsed.data.is_removable,
      is_extra_available: parsed.data.is_extra_available,
      extra_quantity: parsed.data.extra_quantity,
      extra_price: parsed.data.extra_price,
      max_extra_quantity: parsed.data.max_extra_quantity
    })
    .eq("id", id);

  if (error) {
    redirect(`/admin/products/${parsed.data.product_id}/edit?error=${encodeURIComponent(error.message)}`);
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
