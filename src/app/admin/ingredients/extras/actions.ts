"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminActorHash, getCurrentStaff } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { changeExtraPrice, installExtrasCatalog } from "@/lib/extras-service";

async function authorize() {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "admin"].includes(staff.role)) redirect("/admin/login");
}
function refresh() {
  for (const path of ["/menu", "/pos", "/admin/ingredients", "/admin/ingredients/extras"]) revalidatePath(path, "layout");
}
export async function installExtrasAction() {
  await authorize();
  let message = "";
  try {
    const result = await installExtrasCatalog();
    await writeAuditLog({ actorType: "admin", actorRefHash: getAdminActorHash(), action: "extras.catalog.install", entityType: "product_modifier_groups", metadata: result });
  } catch { message = "Не удалось добавить допы. Проверьте наличие и единицы ингредиентов."; }
  refresh();
  redirect(`/admin/ingredients/extras?${message ? `error=${encodeURIComponent(message)}` : "saved=1"}`);
}
export async function updateExtraPriceAction(data: FormData) {
  await authorize();
  const parsed = z.object({ ingredientId: z.uuid(), label: z.string().min(1).max(120), price: z.coerce.number().positive().max(10000).multipleOf(0.01) })
    .safeParse({ ingredientId: data.get("ingredient_id"), label: data.get("label"), price: String(data.get("price") ?? "").replace(/\s/g, "").replace(",", ".") });
  if (!parsed.success) redirect("/admin/ingredients/extras?error=Укажите+корректную+цену");
  let failed = false;
  try {
    const result = await changeExtraPrice(parsed.data.ingredientId, parsed.data.label, parsed.data.price);
    if (!result.length) throw new Error("Missing extra");
    await writeAuditLog({ actorType: "admin", actorRefHash: getAdminActorHash(), action: "extras.price.update", entityType: "ingredient", entityId: parsed.data.ingredientId, metadata: { price: parsed.data.price, options: result.length } });
  } catch { failed = true; }
  refresh();
  redirect(`/admin/ingredients/extras?${failed ? "error=Не+удалось+сохранить+цену" : "saved=1"}`);
}
