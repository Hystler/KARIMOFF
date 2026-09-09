"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdminActorHash, getCurrentStaff } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { saveProductPortions } from "@/lib/product-portions-service";

export async function saveProductPortionsAction(data: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "admin"].includes(staff.role)) redirect("/admin/login");
  const parsed = z.object({ id: z.uuid(), quantities: z.array(z.coerce.number().positive().max(10000)).min(2).max(4),
    prices: z.array(z.coerce.number().positive().max(100000).multipleOf(0.01)).min(2).max(4) }).safeParse({
      id: data.get("product_id"), quantities: data.getAll("portion_quantity"), prices: data.getAll("portion_price").map(value => String(value).replace(/\s/g, "").replace(",", ".")) });
  if (!parsed.success || parsed.data.quantities.length !== parsed.data.prices.length) redirect("/admin/products?error=invalid_portions");
  let error = false;
  try {
    const result = await saveProductPortions(parsed.data.id, parsed.data.quantities.map((quantity, i) => ({ quantity, price: parsed.data.prices[i] })));
    await writeAuditLog({ actorType: "admin", actorRefHash: getAdminActorHash(), action: "product.portions.update", entityType: "product", entityId: parsed.data.id, metadata: result });
  } catch { error = true; }
  for (const path of ["/menu", "/pos", "/admin/products", "/admin/analytics", "/admin/economics"]) revalidatePath(path, "layout");
  redirect(`/admin/products/${parsed.data.id}/edit?${error ? "error=Не+удалось+сохранить+порции.+Проверьте+рецептуру+и+цены." : "saved=portions"}`);
}
