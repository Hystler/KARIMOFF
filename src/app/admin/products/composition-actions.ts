"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { productIngredientFormSchema } from "@/lib/ingredient-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }
}

function getSupabaseOrRedirect(productId: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    redirect(`/admin/products/${productId}/edit?error=supabase`);
  }

  return supabase;
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
    sort_order: formData.get("sort_order") || 100
  });

  const productId = String(formData.get("product_id") || "");

  if (!parsed.success) {
    redirect(`/admin/products/${productId}/edit?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте состав")}`);
  }

  const supabase = getSupabaseOrRedirect(parsed.data.product_id);
  const { error } = await supabase.from("product_ingredients").insert(parsed.data);

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
    sort_order: formData.get("sort_order") || 100
  });

  if (!id || !parsed.success) {
    redirect(`/admin/products/${productId}/edit?error=${encodeURIComponent(parsed.success ? "Не найдена строка состава" : parsed.error.issues[0]?.message ?? "Проверьте состав")}`);
  }

  const supabase = getSupabaseOrRedirect(parsed.data.product_id);
  const { error } = await supabase
    .from("product_ingredients")
    .update({
      ingredient_id: parsed.data.ingredient_id,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit,
      sort_order: parsed.data.sort_order
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

  const supabase = getSupabaseOrRedirect(productId);
  const { error } = await supabase.from("product_ingredients").delete().eq("id", id);

  if (error) {
    redirect(`/admin/products/${productId}/edit?error=${encodeURIComponent(error.message)}`);
  }

  revalidateProductComposition(productId);
  redirect(`/admin/products/${productId}/edit?saved=composition`);
}
