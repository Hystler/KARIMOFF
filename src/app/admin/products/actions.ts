"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { productFormSchema, type ProductFormInput } from "@/lib/product-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }
}

function getSupabaseOrRedirect() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    redirect("/admin/products?error=supabase");
  }

  return supabase;
}

function getProductId(formData: FormData) {
  const id = String(formData.get("id") || "");

  if (!id) {
    redirect("/admin/products?error=missing_id");
  }

  return id;
}

function parseProductForm(formData: FormData) {
  return productFormSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    category: formData.get("category"),
    description: formData.get("description"),
    price: formData.get("price"),
    image_url: formData.get("image_url"),
    sort_order: formData.get("sort_order") || 100,
    is_active: formData.get("is_active") === "on"
  });
}

function toPayload(data: ProductFormInput) {
  return {
    name: data.name,
    slug: data.slug,
    category: data.category,
    description: data.description || null,
    price: data.price,
    image_url: data.image_url || null,
    sort_order: data.sort_order,
    is_active: data.is_active
  };
}

function revalidateProductViews() {
  revalidatePath("/");
  revalidatePath("/menu");
  revalidatePath("/admin/products");
}

export async function createProductAction(formData: FormData) {
  await requireAdmin();

  const parsed = parseProductForm(formData);

  if (!parsed.success) {
    redirect(`/admin/products/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте поля")}`);
  }

  const supabase = getSupabaseOrRedirect();
  const { error } = await supabase.from("products").insert(toPayload(parsed.data));

  if (error) {
    redirect(`/admin/products/new?error=${encodeURIComponent(error.message)}`);
  }

  revalidateProductViews();
  redirect("/admin/products?saved=1");
}

export async function updateProductAction(formData: FormData) {
  await requireAdmin();

  const id = getProductId(formData);
  const parsed = parseProductForm(formData);

  if (!parsed.success) {
    redirect(`/admin/products/${id}/edit?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте поля")}`);
  }

  const supabase = getSupabaseOrRedirect();
  const { error } = await supabase.from("products").update(toPayload(parsed.data)).eq("id", id);

  if (error) {
    redirect(`/admin/products/${id}/edit?error=${encodeURIComponent(error.message)}`);
  }

  revalidateProductViews();
  redirect("/admin/products?saved=1");
}

export async function toggleProductActiveAction(formData: FormData) {
  await requireAdmin();

  const id = getProductId(formData);
  const nextActive = String(formData.get("next_active") || "") === "true";
  const supabase = getSupabaseOrRedirect();
  const { error } = await supabase.from("products").update({ is_active: nextActive }).eq("id", id);

  if (error) {
    redirect(`/admin/products?error=${encodeURIComponent(error.message)}`);
  }

  revalidateProductViews();
  redirect("/admin/products?saved=1");
}

export async function deleteProductAction(formData: FormData) {
  await requireAdmin();

  const id = getProductId(formData);
  const supabase = getSupabaseOrRedirect();
  const { error } = await supabase.from("products").delete().eq("id", id);

  if (error) {
    redirect(`/admin/products?error=${encodeURIComponent(error.message)}`);
  }

  revalidateProductViews();
  redirect("/admin/products?deleted=1");
}
