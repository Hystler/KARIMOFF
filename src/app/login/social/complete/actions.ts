"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { clearAuthFailures, checkAuthRateLimit, recordAuthFailure } from "@/lib/auth-rate-limit";
import { completePendingIdentityRegistration } from "@/lib/auth/social/identity";
import { buildSocialResultPath } from "@/lib/auth/social/redirect";
import {
  clearPendingSocialIdentityCookie,
  readPendingSocialIdentity,
  sanitizeSocialRedirect
} from "@/lib/auth/social/state";
import { normalizePhone } from "@/lib/customer-auth";
import { getShortUserAgent, isChecked } from "@/lib/legal-consents";
import { assertTrustedRequestOrigin } from "@/lib/security/csrf";
import {
  consumeCustomerVerificationCode,
  issueCustomerVerificationCode
} from "@/lib/verification/customer-codes";

export type SocialCompleteState = {
  status: "idle" | "code_sent" | "error";
  message?: string;
  phone?: string;
  name?: string;
};

export const initialSocialCompleteState: SocialCompleteState = { status: "idle" };

const requestSchema = z.object({
  phone: z.string().transform(normalizePhone).refine((value) => /^\+7\d{10}$/.test(value), "Введите корректный телефон."),
  name: z.string().trim().min(2, "Введите имя.").max(80, "Имя слишком длинное.")
});

const confirmSchema = requestSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/, "Введите 6 цифр.")
});

export async function requestSocialPhoneCodeAction(
  _state: SocialCompleteState,
  formData: FormData
): Promise<SocialCompleteState> {
  await assertTrustedRequestOrigin();
  if (!(await readPendingSocialIdentity())) return { status: "error", message: "Сессия входа истекла. Начните заново." };
  if (!isChecked(formData.get("personal_data_consent"))) {
    return { status: "error", message: "Нужно дать согласие на обработку персональных данных." };
  }
  const parsed = requestSchema.safeParse({ phone: formData.get("phone"), name: formData.get("name") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте данные." };

  const limit = await checkAuthRateLimit("send_code", parsed.data.phone);
  if (!limit.allowed) return { status: "error", message: limit.message, ...parsed.data };
  await recordAuthFailure("send_code", parsed.data.phone);
  const sent = await issueCustomerVerificationCode(parsed.data.phone);
  return sent.ok
    ? { status: "code_sent", message: sent.message, ...parsed.data }
    : { status: "error", message: sent.message, ...parsed.data };
}

export async function completeSocialPhoneAction(
  _state: SocialCompleteState,
  formData: FormData
): Promise<SocialCompleteState> {
  await assertTrustedRequestOrigin();
  const pending = await readPendingSocialIdentity();
  if (!pending) return { status: "error", message: "Сессия входа истекла. Начните заново." };
  if (!isChecked(formData.get("personal_data_consent"))) {
    return { status: "error", message: "Нужно дать согласие на обработку персональных данных." };
  }
  const parsed = confirmSchema.safeParse({
    phone: formData.get("phone"),
    name: formData.get("name"),
    code: formData.get("code")
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте данные." };

  const limit = await checkAuthRateLimit("verify_code", parsed.data.phone);
  if (!limit.allowed) return { status: "error", message: limit.message, ...parsed.data };
  const verified = await consumeCustomerVerificationCode(parsed.data.phone, parsed.data.code);
  if (!verified.ok) {
    await recordAuthFailure("verify_code", parsed.data.phone);
    return { status: "error", message: verified.message, ...parsed.data };
  }

  let destination: string;
  try {
    const completed = await completePendingIdentityRegistration({
      ticket: pending.ticket,
      phone: parsed.data.phone,
      name: parsed.data.name,
      marketingConsent: isChecked(formData.get("marketing_consent")),
      userAgent: await getShortUserAgent()
    });
    await clearAuthFailures("verify_code", parsed.data.phone);
    await clearPendingSocialIdentityCookie();
    destination = buildSocialResultPath({
      provider: completed.provider,
      status: "success",
      returnTo: sanitizeSocialRedirect(completed.redirectTo)
    });
  } catch {
    return { status: "error", message: "Не удалось завершить вход. Попробуйте позже.", ...parsed.data };
  }
  redirect(destination);
}
