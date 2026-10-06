"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit";
import { hashPassword } from "@/lib/password-auth";
import { normalizeRussianPhone } from "@/lib/phone";
import { createDatabaseServerClient } from "@/lib/database/server";
import { assertTrustedRequestOrigin } from "@/lib/security/csrf";
import {
  createStaffAccount,
  DuplicateStaffPhoneError,
  isStaffRole,
  parseStaffLocationIds,
  StaffLocationAssignmentError,
  staffRoleRequiresLocation,
  updateStaffRoleAndLocations
} from "@/lib/staff-location-management";

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
  let locationIds: string[];
  try {
    locationIds = parseStaffLocationIds(formData.getAll("location_id").map(String));
  } catch {
    redirect("/admin/staff?error=invalid_location");
  }

  if (name.length < 2 || !/^\+7\d{10}$/.test(phone) || password.length < 10 || !isStaffRole(role)) {
    redirect("/admin/staff?error=invalid_fields");
  }
  if (staffRoleRequiresLocation(role) && !locationIds.length) redirect("/admin/staff?error=location_required");

  let staffId: string;
  try {
    staffId = await createStaffAccount({
      name,
      phone,
      passwordHash: await hashPassword(password),
      role,
      locationIds
    });
  } catch (error) {
    if (error instanceof DuplicateStaffPhoneError) {
      redirect("/admin/staff?error=duplicate_phone");
    }
    if ((error as { code?: string })?.code === "23505") {
      redirect("/admin/staff?error=duplicate_phone");
    }
    if (error instanceof StaffLocationAssignmentError) {
      redirect(`/admin/staff?error=${error.reason}`);
    }
    logStaffManagementFailure("create", error);
    redirect("/admin/staff?error=save");
  }

  await writeAuditLog({
    action: "staff.create",
    actorId: actor.id,
    actorType: actor.legacy ? "admin" : "staff",
    entityId: staffId,
    entityType: "staff",
    metadata: { role, location_ids: staffRoleRequiresLocation(role) ? locationIds : "all" },
    sourcePath: "/admin/staff"
  });
  revalidatePath("/admin/staff");
  redirect("/admin/staff?saved=1");
}

function logStaffManagementFailure(stage: string, error: unknown) {
  const candidate = error as { code?: unknown };
  const code = typeof candidate?.code === "string" && /^[0-9A-Z_]{2,12}$/i.test(candidate.code)
    ? candidate.code
    : undefined;
  console.error(JSON.stringify({
    event: "staff.management.failure",
    stage,
    error_type: error instanceof Error ? error.name : "UnknownError",
    ...(code ? { sqlstate: code } : {})
  }));
}

export async function updateStaffAccessAction(formData: FormData) {
  await assertTrustedRequestOrigin();
  const actor = await requireOwnerAdmin();
  const id = String(formData.get("id") || "");
  const role = String(formData.get("role") || "");
  if (!id || id === actor.id || !isStaffRole(role)) {
    redirect("/admin/staff?error=invalid_staff");
  }

  let locationIds: string[];
  try {
    locationIds = parseStaffLocationIds(formData.getAll("location_id").map(String));
  } catch {
    redirect("/admin/staff?error=invalid_location");
  }
  if (staffRoleRequiresLocation(role) && !locationIds.length) {
    redirect("/admin/staff?error=location_required");
  }

  let updated: boolean;
  try {
    updated = await updateStaffRoleAndLocations({ staffId: id, role, locationIds });
  } catch (error) {
    if (error instanceof StaffLocationAssignmentError) {
      redirect(`/admin/staff?error=${error.reason}`);
    }
    logStaffManagementFailure("update_access", error);
    redirect("/admin/staff?error=save");
  }
  if (!updated) redirect("/admin/staff?error=staff_not_found");

  await writeAuditLog({
    action: "staff.access_change",
    actorId: actor.id,
    actorType: actor.legacy ? "admin" : "staff",
    entityId: id,
    entityType: "staff",
    metadata: { role, location_ids: staffRoleRequiresLocation(role) ? locationIds : "all" },
    sourcePath: "/admin/staff"
  });
  revalidatePath("/admin/staff");
  revalidatePath("/kitchen");
  revalidatePath("/pos");
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

export async function deleteStaffAction(formData: FormData) {
  await assertTrustedRequestOrigin();
  const actor = await requireOwnerAdmin();
  const id = String(formData.get("id") || "");
  if (!id || id === actor.id) redirect("/admin/staff?error=Нельзя удалить собственную учётную запись");

  const database = createDatabaseServerClient();
  if (!database) redirect("/admin/staff?error=database");
  const { data: deletedStaff, error } = await database
    .from("staff_users")
    .delete()
    .eq("id", id)
    .select("id, name, role")
    .maybeSingle();

  if (error) redirect(`/admin/staff?error=${encodeURIComponent(error.message)}`);
  if (!deletedStaff) redirect("/admin/staff?error=Сотрудник уже удалён");

  await database
    .from("app_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("subject_type", "staff")
    .eq("subject_id", id);
  await writeAuditLog({
    action: "staff.delete",
    actorId: actor.id,
    actorType: actor.legacy ? "admin" : "staff",
    entityId: id,
    entityType: "staff",
    metadata: { name: String(deletedStaff.name), role: String(deletedStaff.role) },
    sourcePath: "/admin/staff"
  });
  revalidatePath("/admin/staff");
  redirect("/admin/staff?deleted=1");
}
