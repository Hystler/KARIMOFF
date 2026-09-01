"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminActorHash, isAdminAuthenticated } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { ingredientFormSchema, ingredientPriceSchema } from "@/lib/ingredient-schema";
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
    redirect("/admin/ingredients?error=database");
  }

  return database;
}

function getIngredientId(formData: FormData) {
  const id = String(formData.get("id") || "");

  if (!id) {
    redirect("/admin/ingredients?error=missing_id");
  }

  return id;
}

function getIngredientReturnTo(formData: FormData) {
  return formData.get("return_to") === "/admin/ingredients?view=archived"
    ? "/admin/ingredients?view=archived"
    : "/admin/ingredients";
}

function toPayload(formData: FormData) {
  const parsed = ingredientFormSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    unit: formData.get("unit"),
    package_size: formData.get("package_size") || undefined,
    package_price: formData.get("package_price") || undefined,
    cost_per_unit: formData.get("cost_per_unit") || undefined,
    waste_percent: formData.get("waste_percent") || 0,
    calories_kcal: formData.get("calories_kcal") || undefined,
    proteins_g: formData.get("proteins_g") || undefined,
    fats_g: formData.get("fats_g") || undefined,
    carbohydrates_g: formData.get("carbohydrates_g") || undefined,
    sort_order: formData.get("sort_order") || 100,
    is_active: formData.get("is_active") === "on"
  });

  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  }

  const packageSize = parsed.data.package_size || null;
  const packagePrice = parsed.data.package_price || null;
  const calculatedCost = packageSize && packagePrice ? packagePrice / packageSize : null;
  const costPerUnit = calculatedCost ?? parsed.data.cost_per_unit ?? 0;

  return {
    ok: true as const,
    payload: {
      name: parsed.data.name,
      category: parsed.data.category || null,
      unit: parsed.data.unit,
      cost_per_unit: costPerUnit,
      waste_percent: parsed.data.waste_percent,
      package_size: packageSize,
      package_price: packagePrice,
      nutrition_basis_quantity: parsed.data.unit === "pcs" ? 1 : 100,
      calories_kcal: parsed.data.calories_kcal ?? null,
      proteins_g: parsed.data.proteins_g ?? null,
      fats_g: parsed.data.fats_g ?? null,
      carbohydrates_g: parsed.data.carbohydrates_g ?? null,
      sort_order: parsed.data.sort_order,
      is_active: parsed.data.is_active
    }
  };
}

function revalidateIngredientViews() {
  revalidatePath("/admin/ingredients");
  revalidatePath("/admin/ingredients/prices");
  revalidatePath("/admin/products");
  revalidatePath("/admin/economics");
}

export async function updateIngredientPriceAction(formData: FormData) {
  await requireAdmin();

  const parsed = ingredientPriceSchema.safeParse({
    id: formData.get("id"),
    package_size: formData.get("package_size") || undefined,
    package_price: formData.get("package_price") || undefined,
    cost_per_unit: formData.get("cost_per_unit") || undefined,
    waste_percent: formData.get("waste_percent") || 0
  });

  if (!parsed.success) {
    redirect(`/admin/ingredients/prices?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Проверьте цену")}`);
  }

  const packageSize = parsed.data.package_size ?? null;
  const packagePrice = parsed.data.package_price ?? null;
  const costPerUnit = packageSize && packagePrice ? packagePrice / packageSize : (parsed.data.cost_per_unit ?? 0);
  const database = getDatabaseOrRedirect();
  const { error } = await database
    .from("ingredients")
    .update({
      package_size: packageSize,
      package_price: packagePrice,
      cost_per_unit: costPerUnit,
      waste_percent: parsed.data.waste_percent,
      updated_at: new Date().toISOString()
    })
    .eq("id", parsed.data.id);

  if (error) {
    redirect("/admin/ingredients/prices?error=save");
  }

  await writeAuditLog({
    action: "ingredient.price_update",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    entityId: parsed.data.id,
    entityType: "ingredient",
    metadata: {
      package_size: packageSize,
      package_price: packagePrice,
      cost_per_unit: costPerUnit,
      waste_percent: parsed.data.waste_percent
    },
    sourcePath: "/admin/ingredients/prices"
  });
  revalidateIngredientViews();
  redirect(`/admin/ingredients/prices?saved=${parsed.data.id}`);
}

export async function createIngredientAction(formData: FormData) {
  await requireAdmin();

  const parsed = toPayload(formData);

  if (!parsed.ok) {
    redirect(`/admin/ingredients/new?error=${encodeURIComponent(parsed.message)}`);
  }

  const database = getDatabaseOrRedirect();
  const { error } = await database.from("ingredients").insert(parsed.payload);

  if (error) {
    redirect(`/admin/ingredients/new?error=${encodeURIComponent(error.message)}`);
  }

  await writeAuditLog({
    action: "ingredient.create",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    entityType: "ingredient",
    metadata: { name: parsed.payload.name, unit: parsed.payload.unit },
    sourcePath: "/admin/ingredients/new"
  });
  revalidateIngredientViews();
  redirect("/admin/ingredients?saved=1");
}

export async function updateIngredientAction(formData: FormData) {
  await requireAdmin();

  const id = getIngredientId(formData);
  const parsed = toPayload(formData);

  if (!parsed.ok) {
    redirect(`/admin/ingredients/${id}/edit?error=${encodeURIComponent(parsed.message)}`);
  }

  const database = getDatabaseOrRedirect();
  const { error } = await database.from("ingredients").update(parsed.payload).eq("id", id);

  if (error) {
    redirect(`/admin/ingredients/${id}/edit?error=${encodeURIComponent(error.message)}`);
  }

  await writeAuditLog({
    action: "ingredient.update",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    entityId: id,
    entityType: "ingredient",
    metadata: { cost_per_unit: parsed.payload.cost_per_unit, waste_percent: parsed.payload.waste_percent, unit: parsed.payload.unit },
    sourcePath: `/admin/ingredients/${id}/edit`
  });
  revalidateIngredientViews();
  redirect("/admin/ingredients?saved=1");
}

export async function toggleIngredientActiveAction(formData: FormData) {
  await requireAdmin();

  const id = getIngredientId(formData);
  const nextActive = String(formData.get("next_active") || "") === "true";
  const returnTo = getIngredientReturnTo(formData);
  const database = getDatabaseOrRedirect();
  const { error } = await database.from("ingredients").update({ is_active: nextActive }).eq("id", id);

  if (error) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=save`);
  }

  await writeAuditLog({
    action: "ingredient.status_change",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    entityId: id,
    entityType: "ingredient",
    metadata: { is_active: nextActive },
    sourcePath: "/admin/ingredients"
  });
  revalidateIngredientViews();
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}${nextActive ? "restored" : "archived"}=1`);
}

export async function archiveIngredientAction(formData: FormData) {
  await requireAdmin();

  const id = getIngredientId(formData);
  const database = getDatabaseOrRedirect();
  const { error } = await database.from("ingredients").update({ is_active: false }).eq("id", id);

  if (error) {
    redirect("/admin/ingredients?error=archive");
  }

  await writeAuditLog({
    action: "ingredient.archive",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    entityId: id,
    entityType: "ingredient",
    sourcePath: "/admin/ingredients"
  });
  revalidateIngredientViews();
  redirect("/admin/ingredients?archived=1");
}
