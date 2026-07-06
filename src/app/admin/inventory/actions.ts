"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  correctInventory,
  ensureInventoryItem,
  receiptInventory,
  updateInventoryCard,
  writeOffInventory
} from "@/lib/inventory";

const allowedReturnPaths = new Set([
  "/admin/inventory",
  "/admin/inventory/movements",
  "/admin/ingredients"
]);

async function requireAdmin() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }
}

function parsePositiveNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getIngredientId(formData: FormData) {
  const ingredientId = String(formData.get("ingredient_id") || "");

  if (!ingredientId) {
    redirect("/admin/inventory?error=ingredient_required");
  }

  return ingredientId;
}

function getReturnPath(formData: FormData, fallback = "/admin/inventory") {
  const value = String(formData.get("return_to") || fallback);
  return allowedReturnPaths.has(value) || value.startsWith("/admin/ingredients/") ? value : fallback;
}

function revalidateInventoryViews() {
  revalidatePath("/admin");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin/ingredients");
  revalidatePath("/admin/economics");
}

function redirectWithResult(path: string, result: { ok: boolean; message?: string }) {
  revalidateInventoryViews();

  if (!result.ok) {
    redirect(`${path}?error=${encodeURIComponent(result.message ?? "Ошибка склада")}`);
  }

  redirect(`${path}?saved=1`);
}

export async function createInventoryItemAction(formData: FormData) {
  await requireAdmin();

  const ingredientId = getIngredientId(formData);
  const returnTo = getReturnPath(formData);
  const result = await ensureInventoryItem(ingredientId, {
    currentQuantity: parsePositiveNumber(formData.get("current_quantity")),
    location: String(formData.get("location") || "").trim() || null,
    minQuantity: parsePositiveNumber(formData.get("min_quantity"))
  });

  redirectWithResult(returnTo, result);
}

export async function updateInventoryCardAction(formData: FormData) {
  await requireAdmin();

  const ingredientId = getIngredientId(formData);
  const returnTo = getReturnPath(formData);
  const result = await updateInventoryCard({
    currentQuantity: formData.get("current_quantity") === null ? undefined : parsePositiveNumber(formData.get("current_quantity")),
    ingredientId,
    location: String(formData.get("location") || "").trim() || null,
    minQuantity: parsePositiveNumber(formData.get("min_quantity"))
  });

  redirectWithResult(returnTo, result);
}

export async function receiptInventoryAction(formData: FormData) {
  await requireAdmin();

  const ingredientId = getIngredientId(formData);
  const result = await receiptInventory({
    comment: String(formData.get("comment") || "").trim() || null,
    ingredientId,
    packagePrice: parsePositiveNumber(formData.get("package_price")),
    quantity: parsePositiveNumber(formData.get("quantity")),
    updateCostPerUnit: formData.get("update_cost_per_unit") === "on"
  });

  redirectWithResult("/admin/inventory", result);
}

export async function writeOffInventoryAction(formData: FormData) {
  await requireAdmin();

  const ingredientId = getIngredientId(formData);
  const result = await writeOffInventory({
    comment: String(formData.get("comment") || "").trim() || null,
    ingredientId,
    quantity: parsePositiveNumber(formData.get("quantity")),
    reason: String(formData.get("reason") || "Другое")
  });

  redirectWithResult("/admin/inventory", result);
}

export async function correctInventoryAction(formData: FormData) {
  await requireAdmin();

  const ingredientId = getIngredientId(formData);
  const result = await correctInventory({
    comment: String(formData.get("comment") || "").trim() || null,
    ingredientId,
    newQuantity: parsePositiveNumber(formData.get("new_quantity"))
  });

  redirectWithResult("/admin/inventory", result);
}
