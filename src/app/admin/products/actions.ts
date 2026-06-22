"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { productFormSchema, type ProductFormInput } from "@/lib/product-schema";
import { removeStoragePublicUrl, slugifyStorageSegment, uploadImageToStorage } from "@/lib/storage-images";
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

async function getProductForImages(productId: string) {
  const supabase = getSupabaseOrRedirect();
  const { data, error } = await supabase
    .from("products")
    .select("id, slug, category, image_url")
    .eq("id", productId)
    .maybeSingle();

  if (error || !data) {
    redirect(`/admin/products/${productId}/edit?error=${encodeURIComponent(error?.message ?? "Товар не найден")}`);
  }

  return data;
}

async function syncPrimaryProductImage(productId: string) {
  const supabase = getSupabaseOrRedirect();
  const { data } = await supabase
    .from("product_images")
    .select("id, image_url")
    .eq("product_id", productId)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (data) {
    await supabase.from("product_images").update({ is_primary: true }).eq("id", data.id);
  }

  await supabase.from("products").update({ image_url: data?.image_url ?? null }).eq("id", productId);
}

function redirectToProductEdit(productId: string, search = "saved=1") {
  revalidateProductViews();
  revalidatePath(`/admin/products/${productId}/edit`);
  redirect(`/admin/products/${productId}/edit?${search}`);
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

export async function uploadProductImagesAction(formData: FormData) {
  await requireAdmin();

  const productId = getProductId(formData);
  const product = await getProductForImages(productId);
  const files = formData.getAll("images").filter((file): file is File => file instanceof File && file.size > 0);

  if (files.length === 0) {
    redirectToProductEdit(productId, "error=no_files");
  }

  const supabase = getSupabaseOrRedirect();
  const { count } = await supabase
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  const currentCount = count ?? 0;
  const category = slugifyStorageSegment(String(product.category ?? "products"));
  const slug = slugifyStorageSegment(String(product.slug ?? productId));

  for (const [index, file] of files.entries()) {
    const uploaded = await uploadImageToStorage({
      bucket: "products",
      file,
      path: `${category}/${slug}/${Date.now()}-${currentCount + index + 1}.webp`
    });

    if (uploaded.error || !uploaded.url) {
      redirectToProductEdit(productId, `error=${encodeURIComponent(uploaded.error ?? "Не удалось загрузить фото")}`);
    }

    const { error } = await supabase.from("product_images").insert({
      product_id: productId,
      image_url: uploaded.url,
      alt: String(formData.get("alt") || product.slug || productId),
      sort_order: (currentCount + index + 1) * 10,
      is_primary: currentCount === 0 && index === 0
    });

    if (error) {
      redirectToProductEdit(productId, `error=${encodeURIComponent(error.message)}`);
    }
  }

  await syncPrimaryProductImage(productId);
  redirectToProductEdit(productId);
}

export async function updateProductImageAction(formData: FormData) {
  await requireAdmin();

  const productId = getProductId(formData);
  const imageId = String(formData.get("image_id") || "");
  const alt = String(formData.get("alt") || "").trim() || null;
  const sortOrder = Number(formData.get("sort_order") || 100);

  if (!imageId) {
    redirectToProductEdit(productId, "error=missing_image_id");
  }

  const supabase = getSupabaseOrRedirect();
  const { error } = await supabase
    .from("product_images")
    .update({ alt, sort_order: sortOrder })
    .eq("id", imageId)
    .eq("product_id", productId);

  if (error) {
    redirectToProductEdit(productId, `error=${encodeURIComponent(error.message)}`);
  }

  await syncPrimaryProductImage(productId);
  redirectToProductEdit(productId);
}

export async function setPrimaryProductImageAction(formData: FormData) {
  await requireAdmin();

  const productId = getProductId(formData);
  const imageId = String(formData.get("image_id") || "");

  if (!imageId) {
    redirectToProductEdit(productId, "error=missing_image_id");
  }

  const supabase = getSupabaseOrRedirect();
  const { data, error } = await supabase
    .from("product_images")
    .select("image_url")
    .eq("id", imageId)
    .eq("product_id", productId)
    .maybeSingle();

  if (error || !data) {
    redirectToProductEdit(productId, `error=${encodeURIComponent(error?.message ?? "Фото не найдено")}`);
  }

  const imageUrl = String((data as { image_url: string }).image_url);
  await supabase.from("product_images").update({ is_primary: false }).eq("product_id", productId);
  const { error: updateError } = await supabase
    .from("product_images")
    .update({ is_primary: true })
    .eq("id", imageId)
    .eq("product_id", productId);

  if (updateError) {
    redirectToProductEdit(productId, `error=${encodeURIComponent(updateError.message)}`);
  }

  await supabase.from("products").update({ image_url: imageUrl }).eq("id", productId);
  redirectToProductEdit(productId);
}

export async function deleteProductImageAction(formData: FormData) {
  await requireAdmin();

  const productId = getProductId(formData);
  const imageId = String(formData.get("image_id") || "");

  if (!imageId) {
    redirectToProductEdit(productId, "error=missing_image_id");
  }

  const supabase = getSupabaseOrRedirect();
  const { data, error } = await supabase
    .from("product_images")
    .select("image_url")
    .eq("id", imageId)
    .eq("product_id", productId)
    .maybeSingle();

  if (error || !data) {
    redirectToProductEdit(productId, `error=${encodeURIComponent(error?.message ?? "Фото не найдено")}`);
  }

  const imageUrl = String((data as { image_url: string }).image_url);
  const { error: deleteError } = await supabase
    .from("product_images")
    .delete()
    .eq("id", imageId)
    .eq("product_id", productId);

  if (deleteError) {
    redirectToProductEdit(productId, `error=${encodeURIComponent(deleteError.message)}`);
  }

  await removeStoragePublicUrl("products", imageUrl);
  await syncPrimaryProductImage(productId);
  redirectToProductEdit(productId);
}
