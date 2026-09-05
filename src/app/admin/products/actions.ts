"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminActorHash, isAdminAuthenticated } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import {
  productCompositionDraftSchema,
  productFormSchema,
  type ProductCompositionDraftInput,
  type ProductFormInput
} from "@/lib/product-schema";
import { getPostgresSql } from "@/lib/postgres/server";
import { removeStoragePublicUrl, slugifyStorageSegment, uploadImageToStorage } from "@/lib/storage-images";
import { createDatabaseServerClient } from "@/lib/database/server";

async function requireAdmin() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }
}

function getDatabaseOrRedirect() {
  const database = createDatabaseServerClient();

  if (!database) {
    redirect("/admin/products?error=database");
  }

  return database;
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
    weight: formData.get("weight"),
    allergens: formData.get("allergens"),
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
    weight: data.weight || null,
    allergens: data.allergens
      ? data.allergens.split(",").map((item) => item.trim()).filter(Boolean)
      : null,
    sort_order: data.sort_order,
    is_active: data.is_active
  };
}

function parseProductComposition(formData: FormData) {
  let value: unknown;
  try {
    value = JSON.parse(String(formData.get("composition_json") || "[]"));
  } catch {
    return { ok: false as const, message: "Не удалось прочитать рецептуру" };
  }

  const parsed = productCompositionDraftSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false as const,
      message: parsed.error.issues[0]?.message ?? "Проверьте рецептуру"
    };
  }

  const ingredientIds = parsed.data.map((line) => line.ingredient_id);
  if (new Set(ingredientIds).size !== ingredientIds.length) {
    return { ok: false as const, message: "Один ингредиент указан в рецептуре несколько раз" };
  }

  return { ok: true as const, data: parsed.data };
}

function productCreateError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("products_slug_key") || message.includes("duplicate key")) {
    return "Товар с таким slug уже существует";
  }
  if (message.includes("PRODUCT_INGREDIENT")) {
    return message.replace("PRODUCT_INGREDIENT:", "");
  }
  return "Не удалось сохранить товар и рецептуру";
}

async function createProductWithComposition(
  product: ProductFormInput,
  composition: ProductCompositionDraftInput
) {
  const payload = toPayload(product);
  const sql = getPostgresSql();
  return sql.begin(async (transaction) => {
    const [createdProduct] = await transaction<{ id: string }[]>`
      insert into public.products (
        name,
        slug,
        category,
        description,
        price,
        image_url,
        weight,
        allergens,
        sort_order,
        is_active,
        calories,
        protein,
        fat,
        carbs
      ) values (
        ${payload.name},
        ${payload.slug},
        ${payload.category},
        ${payload.description},
        ${payload.price},
        ${payload.image_url},
        ${payload.weight},
        ${payload.allergens}::text[],
        ${payload.sort_order},
        ${payload.is_active},
        null,
        null,
        null,
        null
      )
      returning id::text
    `;

    if (!createdProduct) {
      throw new Error("PRODUCT_CREATE_FAILED");
    }

    for (const line of composition) {
      const [ingredient] = await transaction<{ id: string; unit: "g" | "ml" | "pcs" }[]>`
        select id::text, unit
        from public.ingredients
        where id = ${line.ingredient_id}::uuid
          and is_active = true
        for share
      `;
      if (!ingredient) {
        throw new Error("PRODUCT_INGREDIENT:Выбранный ингредиент не найден или отключён");
      }
      if (ingredient.unit !== line.unit) {
        throw new Error("PRODUCT_INGREDIENT:Единица ингредиента изменилась. Обновите форму и повторите");
      }

      await transaction`
        insert into public.product_ingredients (
          product_id,
          ingredient_id,
          quantity,
          unit,
          sort_order,
          station
        ) values (
          ${createdProduct.id}::uuid,
          ${line.ingredient_id}::uuid,
          ${line.quantity},
          ${line.unit},
          ${line.sort_order},
          ${line.station || null}
        )
      `;
    }

    return createdProduct.id;
  });
}

function revalidateProductViews() {
  revalidatePath("/");
  revalidatePath("/menu");
  revalidatePath("/menu/[slug]", "page");
  revalidatePath("/admin/products");
}

async function getProductForImages(productId: string) {
  const database = getDatabaseOrRedirect();
  const { data, error } = await database
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
  const database = getDatabaseOrRedirect();
  const { data } = await database
    .from("product_images")
    .select("id, image_url")
    .eq("product_id", productId)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (data) {
    await database.from("product_images").update({ is_primary: true }).eq("id", data.id);
  }

  await database.from("products").update({ image_url: data?.image_url ?? null }).eq("id", productId);
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

  const composition = parseProductComposition(formData);
  if (!composition.ok) {
    redirect(`/admin/products/new?error=${encodeURIComponent(composition.message)}`);
  }

  let productId: string;
  try {
    productId = await createProductWithComposition(parsed.data, composition.data);
  } catch (error) {
    redirect(`/admin/products/new?error=${encodeURIComponent(productCreateError(error))}`);
  }

  await writeAuditLog({
    action: "product.create",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    entityType: "product",
    entityId: productId,
    metadata: { name: parsed.data.name, price: parsed.data.price, ingredient_count: composition.data.length },
    sourcePath: "/admin/products/new"
  });
  revalidateProductViews();
  redirect(`/admin/products/${productId}/edit?saved=created`);
}

export async function updateProductAction(formData: FormData) {
  await requireAdmin();

  const id = getProductId(formData);
  const parsed = parseProductForm(formData);

  if (!parsed.success) {
    redirect(`/admin/products/${id}/edit?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте поля")}`);
  }

  const database = getDatabaseOrRedirect();
  const { data: previous } = await database.from("products").select("price").eq("id", id).maybeSingle();
  const { error } = await database.from("products").update(toPayload(parsed.data)).eq("id", id);

  if (error) {
    redirect(`/admin/products/${id}/edit?error=${encodeURIComponent(error.message)}`);
  }

  if (Number(previous?.price) !== parsed.data.price) {
    await writeAuditLog({
      action: "product.price_change",
      actorRefHash: getAdminActorHash(),
      actorType: "admin",
      entityId: id,
      entityType: "product",
      metadata: { from: Number(previous?.price ?? 0), to: parsed.data.price },
      sourcePath: `/admin/products/${id}/edit`
    });
  }
  revalidateProductViews();
  redirect("/admin/products?saved=1");
}

export async function toggleProductActiveAction(formData: FormData) {
  await requireAdmin();

  const id = getProductId(formData);
  const nextActive = String(formData.get("next_active") || "") === "true";
  const database = getDatabaseOrRedirect();
  const { error } = await database.from("products").update({ is_active: nextActive }).eq("id", id);

  if (error) {
    redirect(`/admin/products?error=${encodeURIComponent(error.message)}`);
  }

  await writeAuditLog({
    action: "product.status_change",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    entityId: id,
    entityType: "product",
    metadata: { is_active: nextActive },
    sourcePath: "/admin/products"
  });
  revalidateProductViews();
  redirect("/admin/products?saved=1");
}

export async function deleteProductAction(formData: FormData) {
  await requireAdmin();

  const id = getProductId(formData);
  const database = getDatabaseOrRedirect();
  const { error } = await database.from("products").delete().eq("id", id);

  if (error) {
    redirect(`/admin/products?error=${encodeURIComponent(error.message)}`);
  }

  await writeAuditLog({
    action: "product.delete",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    entityId: id,
    entityType: "product",
    sourcePath: "/admin/products"
  });
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

  const database = getDatabaseOrRedirect();
  const { count } = await database
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

    const { error } = await database.from("product_images").insert({
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

  const database = getDatabaseOrRedirect();
  const { error } = await database
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

  const database = getDatabaseOrRedirect();
  const { data, error } = await database
    .from("product_images")
    .select("image_url")
    .eq("id", imageId)
    .eq("product_id", productId)
    .maybeSingle();

  if (error || !data) {
    redirectToProductEdit(productId, `error=${encodeURIComponent(error?.message ?? "Фото не найдено")}`);
  }

  const imageUrl = String(data!.image_url);
  await database.from("product_images").update({ is_primary: false }).eq("product_id", productId);
  const { error: updateError } = await database
    .from("product_images")
    .update({ is_primary: true })
    .eq("id", imageId)
    .eq("product_id", productId);

  if (updateError) {
    redirectToProductEdit(productId, `error=${encodeURIComponent(updateError.message)}`);
  }

  await database.from("products").update({ image_url: imageUrl }).eq("id", productId);
  redirectToProductEdit(productId);
}

export async function deleteProductImageAction(formData: FormData) {
  await requireAdmin();

  const productId = getProductId(formData);
  const imageId = String(formData.get("image_id") || "");

  if (!imageId) {
    redirectToProductEdit(productId, "error=missing_image_id");
  }

  const database = getDatabaseOrRedirect();
  const { data, error } = await database
    .from("product_images")
    .select("image_url")
    .eq("id", imageId)
    .eq("product_id", productId)
    .maybeSingle();

  if (error || !data) {
    redirectToProductEdit(productId, `error=${encodeURIComponent(error?.message ?? "Фото не найдено")}`);
  }

  const imageUrl = String(data!.image_url);
  const { error: deleteError } = await database
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
