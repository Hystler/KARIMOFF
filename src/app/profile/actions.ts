"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAuditLog } from "@/lib/audit";
import { clearCustomerSession, getCurrentCustomer } from "@/lib/customer-auth";
import { getShortUserAgent, isChecked, recordLegalConsents } from "@/lib/legal-consents";
import { getPostgresSql } from "@/lib/postgres/server";
import { assertTrustedRequestOrigin } from "@/lib/security/csrf";
import { isSocialProvider } from "@/lib/auth/social/types";
import { canUnlinkAuthenticationMethod } from "@/lib/auth/social/linking-rules";

export async function updateMarketingConsentAction(formData: FormData) {
  await assertTrustedRequestOrigin();
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
  await assertTrustedRequestOrigin();
  await clearCustomerSession();
  redirect("/");
}

export async function unlinkSocialIdentityAction(formData: FormData) {
  await assertTrustedRequestOrigin();
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/login?redirectTo=/profile");
  const provider = String(formData.get("provider") || "");
  if (!isSocialProvider(provider)) redirect("/profile?identity_error=invalid");

  const sql = getPostgresSql();
  const removed = await sql.begin(async (transaction) => {
    const identities = await transaction<{ provider: string }[]>`
      select provider
      from public.user_identities
      where user_id = ${customer.id}::uuid
      for update
    `;
    const [account] = await transaction<{ password_hash: string | null }[]>`
      select password_hash from public.customers where id = ${customer.id}::uuid for update
    `;
    const hasPasswordFallback = Boolean(account?.password_hash) && !identities.some((identity) => identity.provider === "phone");
    if (!canUnlinkAuthenticationMethod(identities.length, hasPasswordFallback)) {
      throw new Error("Нельзя удалить последний способ входа.");
    }
    const deleted = await transaction`
      delete from public.user_identities
      where user_id = ${customer.id}::uuid and provider = ${provider}
      returning id
    `;
    return deleted.length > 0;
  }).catch(() => false);

  if (!removed) redirect("/profile?identity_error=last_method");
  await writeAuditLog({
    action: "customer.identity_unlinked",
    actorId: customer.id,
    actorType: "customer",
    entityId: customer.id,
    entityType: "customer",
    metadata: { provider },
    sourcePath: "/profile"
  });
  revalidatePath("/profile");
  redirect("/profile?identity=unlinked");
}
