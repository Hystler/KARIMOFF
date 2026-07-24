"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAuditLog } from "@/lib/audit";
import { clearCustomerSession, getCurrentCustomer } from "@/lib/customer-auth";
import { getShortUserAgent, isChecked, recordLegalConsents } from "@/lib/legal-consents";

export async function updateMarketingConsentAction(formData: FormData) {
  const customer = await getCurrentCustomer();

  if (!customer) {
    redirect("/login?redirectTo=/profile");
  }

  const granted = isChecked(formData.get("marketing_consent"));
  const userAgent = await getShortUserAgent();
  const result = await recordLegalConsents({
    subjectId: customer.id,
    subjectType: "customer",
    sourcePath: "/profile",
    userAgent,
    consents: [{ type: "marketing", granted }]
  });

  if (!result.ok) {
    redirect(`/profile?error=${encodeURIComponent(result.message)}`);
  }

  await writeAuditLog({
    action: granted ? "consent.marketing_granted" : "consent.marketing_revoked",
    actorId: customer.id,
    actorType: "customer",
    entityId: customer.id,
    entityType: "legal_consent",
    metadata: { granted },
    sourcePath: "/profile",
    userAgent
  });
  revalidatePath("/profile");
  redirect("/profile?consent_saved=1");
}

export async function logoutCustomerAction() {
  await clearCustomerSession();
  redirect("/");
}
