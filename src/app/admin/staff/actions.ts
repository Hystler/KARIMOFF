"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { hashPassword } from "@/lib/password-auth";
import { normalizeRussianPhone } from "@/lib/phone";
import { createDatabaseServerClient } from "@/lib/database/server";
import { assertTrustedRequestOrigin } from "@/lib/security/csrf";

async function requireOwnerAdmin() {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "admin"].includes(staff.role)) redirect("/admin");
  return staff;
}

export async function createStaffAction(formData: FormData) {
  await assertTrustedRequestOrigin();
  const actor = await requireOwnerAdmin();
  const name = String(formData.get("name") || "").trim();
  const phone = normalizeRussianPhone(String(formData.get("phone") || ""));
  const password = String(formData.get("password") || "");
  const role = String(formData.get("role") || "");

  if (name.length < 2 || !/^\+7\d{10}$/.test(phone) || password.length < 10 || !["owner", "admin", "manager", "cashier", "cook"].includes(role)) {
    redirect("/admin/staff?error=Проверьте имя, телефон, роль и пароль от 10 символов");
  }

  const database = createDatabaseServerClient();
  if (!database) redirect("/admin/staff?error=database");
  const { data, error } = await database.from("staff_users").insert({
    name,
    phone,
    password_hash: await hashPassword(password),
    role,
    is_active: true
  }).select("id").single();

  if (error) redirect(`/admin/staff?error=${encodeURIComponent(error.message)}`);
  await writeAuditLog({
    action: "staff.create",
    actorId: actor.id,
    actorType: actor.legacy ? "admin" : "staff",
    entityId: String(data?.id ?? ""),
    entityType: "staff",
    metadata: { role },
    sourcePath: "/admin/staff"
  });
  revalidatePath("/admin/staff");
  redirect("/admin/staff?saved=1");
}

export async function toggleStaffAction(formData: FormData) {
  await assertTrustedRequestOrigin();
  const actor = await requireOwnerAdmin();
  const id = String(formData.get("id") || "");
  const isActive = formData.get("is_active") === "true";
  if (!id || id === actor.id) redirect("/admin/staff?error=Нельзя отключить собственную учётную запись");

  const database = createDatabaseServerClient();
  if (!database) redirect("/admin/staff?error=database");
  const { error } = await database.from("staff_users").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) redirect(`/admin/staff?error=${encodeURIComponent(error.message)}`);

  if (!isActive) {
    await database.from("app_sessions").update({ revoked_at: new Date().toISOString() }).eq("subject_type", "staff").eq("subject_id", id);
  }
  await writeAuditLog({
    action: "staff.status_change",
    actorId: actor.id,
    actorType: actor.legacy ? "admin" : "staff",
    entityId: id,
    entityType: "staff",
    metadata: { is_active: isActive },
    sourcePath: "/admin/staff"
  });
  revalidatePath("/admin/staff");
  redirect("/admin/staff?saved=1");
}
