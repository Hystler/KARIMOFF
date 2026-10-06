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
import { findRussianPhoneLookupCandidate, getPhoneLookupCandidates, normalizeRussianPhone } from "@/lib/phone";
import { createDatabaseServerClient } from "@/lib/database/server";
import { assertTrustedRequestOrigin } from "@/lib/security/csrf";
import { verifyStaffLoginCsrfToken } from "@/lib/security/staff-login-csrf";

function logLoginFailure(stage: string, error: unknown) {
  const candidate = error as { code?: unknown };
  const code = typeof candidate?.code === "string" && /^[0-9A-Z_]{2,12}$/i.test(candidate.code)
    ? candidate.code
    : undefined;
  console.error(JSON.stringify({
    event: "staff.login.failure",
    stage,
    error_type: error instanceof Error ? error.name : "UnknownError",
    ...(code ? { sqlstate: code } : {})
  }));
}

export async function loginAction(formData: FormData) {
  if (!verifyStaffLoginCsrfToken(String(formData.get("csrf_token") || ""))) {
    console.warn(JSON.stringify({ event: "staff.login.security_rejected", stage: "csrf", error_type: "InvalidCsrfToken" }));
    redirect("/admin/login?error=session_expired");
  }
  await assertTrustedRequestOrigin();
  const phone = String(formData.get("phone") || "");
  const password = String(formData.get("password") || "");
  const totp = String(formData.get("totp") || "");
  const normalizedPhone = normalizeRussianPhone(phone);

  if (!/^\+7\d{10}$/.test(normalizedPhone)) {
    await recordAuthFailure("admin_login", normalizedPhone);
    redirect("/admin/login?error=invalid");
  }

  const limit = await checkAuthRateLimit("admin_login", normalizedPhone);

  if (!limit.allowed) {
    redirect(`/admin/login?error=${encodeURIComponent(limit.message ?? "Слишком много попыток входа.")}`);
  }

  const database = createDatabaseServerClient();
  const { data: staffCandidates, error: lookupError } = database
    ? await database
        .from("staff_users")
        .select("id, name, phone, role, password_hash, is_active")
        .in("phone", getPhoneLookupCandidates(phone))
    : { data: [], error: null };

  if (lookupError) {
    logLoginFailure("staff_lookup", lookupError);
    redirect("/admin/login?error=unavailable");
  }

  const staffRows = (Array.isArray(staffCandidates) ? staffCandidates : staffCandidates ? [staffCandidates] : []) as unknown as {
    id: string;
    name: string;
    phone: string;
    role: string;
    password_hash: string;
    is_active: boolean;
  }[];
  const staff = findRussianPhoneLookupCandidate(staffRows, phone);

  if (staff?.is_active && (await verifyPassword(password, String(staff.password_hash)))) {
    await clearAuthFailures("admin_login", normalizedPhone);
    try {
      await setStaffSession(String(staff.id));
    } catch (error) {
      logLoginFailure("staff_session", error);
      redirect("/admin/login?error=unavailable");
    }
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
