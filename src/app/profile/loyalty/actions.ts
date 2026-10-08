"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { getShortUserAgent, recordLegalConsents } from "@/lib/legal-consents";
import { ensureLoyaltyAccount } from "@/lib/loyalty";
import { ensureLoyaltyCard, rotateLoyaltyCard } from "@/lib/loyalty-card";
import { assertTrustedRequestOrigin } from "@/lib/security/csrf";

export async function rotateLoyaltyCardAction() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/login?redirectTo=/profile/loyalty");
  await rotateLoyaltyCard(customer.id);
  revalidatePath("/profile/loyalty");
}

export async function joinLoyaltyAction() {
  await assertTrustedRequestOrigin();
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/login?redirectTo=/profile/loyalty");

  const result = await recordLegalConsents({
    subjectId: customer.id,
    subjectType: "customer",
    sourcePath: "/profile/loyalty",
    userAgent: await getShortUserAgent(),
    consents: [{ type: "loyalty_rules", granted: true }]
  });
  if (!result.ok) redirect(`/profile/loyalty?error=${encodeURIComponent(result.message)}`);

  await Promise.all([ensureLoyaltyAccount(customer.id), ensureLoyaltyCard(customer.id)]);
  revalidatePath("/profile");
  revalidatePath("/profile/loyalty");
  redirect("/profile/loyalty");
}
