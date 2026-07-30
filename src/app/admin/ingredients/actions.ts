"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminActorHash, isAdminAuthenticated } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { ingredientFormSchema } from "@/lib/ingredient-schema";
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

function toPayload(formData: FormData) {
  const parsed = ingredientFormSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    unit: formData.get("unit"),
    package_size: formData.get("package_size") || undefined,
    package_price: formData.get("package_price") || undefined,
    cost_per_unit: formData.get("cost_per_unit") || undefined,
    sort_order: formData.get("sort_order") || 100,
    is_active: formData.get("is_active") === "on"
  });

  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  }

  const packageSize = parsed.data.package_size || null;
  const packagePrice = parsed.data.package_price || null;
  const calculatedCost = packageSize && packagePrice ? packagePrice / packageSize : null;
  const costPerUnit = parsed.data.cost_per_unit ?? calculatedCost ?? 0;

  return {
    ok: true as const,
    payload: {
      name: parsed.data.name,
      category: parsed.data.category || null,
      unit: parsed.data.unit,
      cost_per_unit: costPerUnit,
      package_size: packageSize,
      package_price: packagePrice,
      sort_order: parsed.data.sort_order,
      is_active: parsed.data.is_active
    }
  };
}

function revalidateIngredientViews() {
  revalidatePath("/admin/ingredients");
  revalidatePath("/admin/products");
  revalidatePath("/admin/economics");
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
    metadata: { cost_per_unit: parsed.payload.cost_per_unit, unit: parsed.payload.unit },
    sourcePath: `/admin/ingredients/${id}/edit`
  });
  revalidateIngredientViews();
  redirect("/admin/ingredients?saved=1");
}

export async function toggleIngredientActiveAction(formData: FormData) {
  await requireAdmin();

  const id = getIngredientId(formData);
  const nextActive = String(formData.get("next_active") || "") === "true";
  const database = getDatabaseOrRedirect();
  const { error } = await database.from("ingredients").update({ is_active: nextActive }).eq("id", id);

  if (error) {
    redirect(`/admin/ingredients?error=${encodeURIComponent(error.message)}`);
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
  redirect("/admin/ingredients?saved=1");
}

export async function deleteIngredientAction(formData: FormData) {
  await requireAdmin();

  const id = getIngredientId(formData);
  const database = getDatabaseOrRedirect();
  const { error } = await database.from("ingredients").delete().eq("id", id);

  if (error) {
    redirect(`/admin/ingredients?error=${encodeURIComponent(error.message)}`);
  }

  await writeAuditLog({
    action: "ingredient.delete",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    entityId: id,
    entityType: "ingredient",
    sourcePath: "/admin/ingredients"
  });
  revalidateIngredientViews();
  redirect("/admin/ingredients?deleted=1");
}
