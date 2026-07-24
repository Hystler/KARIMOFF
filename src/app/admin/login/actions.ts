"use server";

import { redirect } from "next/navigation";
import { clearAuthFailures, checkAuthRateLimit, recordAuthFailure } from "@/lib/auth-rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  clearAdminSession,
  getAdminActorHash,
  isAdminConfigured,
  setAdminSession,
  verifyAdminCredentials
} from "@/lib/admin-auth";
import { normalizeRussianPhone } from "@/lib/phone";

export async function loginAction(formData: FormData) {
  const phone = String(formData.get("phone") || "");
  const password = String(formData.get("password") || "");
  const totp = String(formData.get("totp") || "");
  const normalizedPhone = normalizeRussianPhone(phone);

  if (!isAdminConfigured()) {
    redirect("/admin/login?error=not_configured");
  }

  const limit = await checkAuthRateLimit("admin_login", normalizedPhone);

  if (!limit.allowed) {
    redirect(`/admin/login?error=${encodeURIComponent(limit.message ?? "Слишком много попыток входа.")}`);
  }

  if (!verifyAdminCredentials(phone, password, totp)) {
    await recordAuthFailure("admin_login", normalizedPhone);
    await writeAuditLog({
      action: "admin.login_failed",
      actorRefHash: getAdminActorHash(),
      actorType: "admin",
      sourcePath: "/admin/login"
    });
    redirect("/admin/login?error=invalid");
  }

  await clearAuthFailures("admin_login", normalizedPhone);
  await setAdminSession(normalizedPhone);
  await writeAuditLog({
    action: "admin.login",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    sourcePath: "/admin/login"
  });
  redirect("/admin");
}

export async function logoutAction() {
  await writeAuditLog({
    action: "admin.logout",
    actorRefHash: getAdminActorHash(),
    actorType: "admin",
    sourcePath: "/admin"
  });
  await clearAdminSession();
  redirect("/admin/login");
}
