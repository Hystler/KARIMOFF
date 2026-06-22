"use server";

import { redirect } from "next/navigation";
import {
  clearAdminSession,
  isAdminConfigured,
  setAdminSession,
  verifyAdminCredentials
} from "@/lib/admin-auth";
import { normalizeRussianPhone } from "@/lib/phone";

export async function loginAction(formData: FormData) {
  const phone = String(formData.get("phone") || "");
  const password = String(formData.get("password") || "");

  if (!isAdminConfigured()) {
    redirect("/admin/login?error=not_configured");
  }

  if (!verifyAdminCredentials(phone, password)) {
    redirect("/admin/login?error=invalid");
  }

  await setAdminSession(normalizeRussianPhone(phone));
  redirect("/admin");
}

export async function logoutAction() {
  await clearAdminSession();
  redirect("/admin/login");
}
