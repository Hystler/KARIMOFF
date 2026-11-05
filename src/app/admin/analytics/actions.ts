"use server";

import { assertStagingBusinessWriteAllowed } from "@/lib/staging-access";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/admin-auth";

export async function refreshAnalyticsAction() {
  assertStagingBusinessWriteAllowed();
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!staff.legacy && !["owner", "admin", "manager"].includes(staff.role)) redirect("/admin");
  updateTag("karimoff-analytics");
}
