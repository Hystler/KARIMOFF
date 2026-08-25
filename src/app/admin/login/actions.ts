"use server";

import { redirect } from "next/navigation";
import { clearAuthFailures, checkAuthRateLimit, recordAuthFailure } from "@/lib/auth-rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  clearAdminSession,
  getAdminActorHash,
  setAdminSession,
  setStaffSession,
  verifyAdminCredentials
} from "@/lib/admin-auth";
import { hashPrivacyValue } from "@/lib/legal-consents";
import { hashPassword, passwordNeedsRehash, verifyPassword } from "@/lib/password-auth";
import { normalizeRussianPhone } from "@/lib/phone";
import { getPhoneLookupCandidates } from "@/lib/phone";
import { createDatabaseServerClient } from "@/lib/database/server";
import { assertTrustedRequestOrigin } from "@/lib/security/csrf";

export async function loginAction(formData: FormData) {
  await assertTrustedRequestOrigin();
  const phone = String(formData.get("phone") || "");
  const password = String(formData.get("password") || "");
  const totp = String(formData.get("totp") || "");
  const normalizedPhone = normalizeRussianPhone(phone);

  const limit = await checkAuthRateLimit("admin_login", normalizedPhone);

  if (!limit.allowed) {
    redirect(`/admin/login?error=${encodeURIComponent(limit.message ?? "Слишком много попыток входа.")}`);
  }

  const database = createDatabaseServerClient();
  const { data: staff } = database
    ? await database
        .from("staff_users")
        .select("id, name, role, password_hash, is_active")
        .in("phone", getPhoneLookupCandidates(phone))
        .limit(1)
        .maybeSingle()
    : { data: null };

  if (staff?.is_active && (await verifyPassword(password, String(staff.password_hash)))) {
    await clearAuthFailures("admin_login", normalizedPhone);
    await setStaffSession(String(staff.id));
    await database
      ?.from("staff_users")
      .update({
        last_login_at: new Date().toISOString(),
        ...(passwordNeedsRehash(String(staff.password_hash)) ? { password_hash: await hashPassword(password) } : {})
      })
      .eq("id", staff.id);
    await writeAuditLog({
      action: "staff.login",
      actorId: String(staff.id),
      actorRefHash: hashPrivacyValue(normalizedPhone),
      actorType: "staff",
      entityId: String(staff.id),
      entityType: "staff",
      metadata: { role: staff.role },
      sourcePath: "/admin/login"
    });
    redirect(staff.role === "cook" ? "/kitchen" : staff.role === "cashier" ? "/pos" : "/admin");
  }

  if (!(await verifyAdminCredentials(phone, password, totp))) {
    await recordAuthFailure("admin_login", normalizedPhone);
    await writeAuditLog({
      action: "admin.login_failed",
      actorRefHash: hashPrivacyValue(normalizedPhone),
      actorType: "admin",
      sourcePath: "/admin/login"
    });
    redirect("/admin/login?error=invalid");
  }

  await clearAuthFailures("admin_login", normalizedPhone);
  await setAdminSession();
  await writeAuditLog({
    action: "admin.login",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    sourcePath: "/admin/login"
  });
  redirect("/admin");
}

export async function logoutAction() {
  await assertTrustedRequestOrigin();
  await writeAuditLog({
    action: "admin.logout",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    sourcePath: "/admin"
  });
  await clearAdminSession();
  redirect("/admin/login");
}
