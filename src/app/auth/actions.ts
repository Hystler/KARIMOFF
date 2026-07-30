"use server";

import { redirect } from "next/navigation";
import { clearAuthFailures, checkAuthRateLimit, recordAuthFailure } from "@/lib/auth-rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  createVerificationCode,
  getVerificationExpiresAt,
  hashVerificationCode,
  normalizePhone,
  setCustomerSession
} from "@/lib/customer-auth";
import {
  initialAuthActionState,
  loginConfirmSchema,
  passwordLoginSchema,
  passwordRegisterSchema,
  loginRequestSchema,
  registerConfirmSchema,
  registerRequestSchema,
  type AuthActionState
} from "@/lib/customer-schema";
import { ensureLoyaltyAccount } from "@/lib/loyalty";
import {
  getShortUserAgent,
  hashPrivacyValue,
  isChecked,
  recordLegalConsents
} from "@/lib/legal-consents";
import { hashPassword, verifyPassword } from "@/lib/password-auth";
import { getPhoneLookupCandidates } from "@/lib/phone";
import { sendVerificationCode } from "@/lib/verification/send-code";
import { createDatabaseServerClient } from "@/lib/database/server";

async function saveVerificationCode(phone: string, code: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    return { ok: false, message: "База данных не подключена." };
  }

  const normalizedPhone = normalizePhone(phone);
  const { error } = await database.from("verification_codes").insert({
    phone: normalizedPhone,
    code_hash: hashVerificationCode(normalizedPhone, code),
    expires_at: getVerificationExpiresAt()
  });

  if (error) {
    return { ok: false, message: "Не удалось сохранить код подтверждения." };
  }

  const sent = await sendVerificationCode(normalizedPhone, code);

  if (!sent.ok) {
    return { ok: false, message: "Сервис отправки кода пока не настроен." };
  }

  return { ok: true, message: "Код отправлен. В dev-режиме он выведен в консоль сервера." };
}

async function verifyCode(phone: string, code: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    return { ok: false, message: "База данных не подключена." };
  }

  const normalizedPhone = normalizePhone(phone);
  const { data, error } = await database
    .from("verification_codes")
    .select("id, code_hash, expires_at, used_at")
    .eq("phone", normalizedPhone)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: "Код не найден или истёк." };
  }

  const expectedHash = hashVerificationCode(normalizedPhone, code);

  if (String(data.code_hash) !== expectedHash) {
    return { ok: false, message: "Неверный код подтверждения." };
  }

  const { error: updateError } = await database
    .from("verification_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data.id);

  if (updateError) {
    return { ok: false, message: "Не удалось подтвердить код." };
  }

  return { ok: true, message: "" };
}

function sanitizeRedirectPath(path?: string | null) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return null;
  }

  return path;
}

function getRedirectPath(redirectTo?: string | null, next?: string | null) {
  const sanitizedRedirect = sanitizeRedirectPath(redirectTo);

  if (sanitizedRedirect) {
    return sanitizedRedirect;
  }

  if (next === "checkout") {
    return "/checkout";
  }

  return "/profile";
}

async function saveRegistrationConsents(
  customerId: string,
  formData: FormData,
  sourcePath: string
) {
  return recordLegalConsents({
    subjectId: customerId,
    subjectType: "customer",
    sourcePath,
    userAgent: await getShortUserAgent(),
    consents: [
      { type: "personal_data", granted: true },
      { type: "marketing", granted: isChecked(formData.get("marketing_consent")) },
      { type: "loyalty_rules", granted: isChecked(formData.get("loyalty_consent")) }
    ]
  });
}

async function findCustomerForLogin(phone: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    return { database, data: null, error: null };
  }

  const candidates = getPhoneLookupCandidates(phone);
  const { data, error } = await database
    .from("customers")
    .select("id, phone, password_hash")
    .in("phone", candidates)
    .limit(1)
    .maybeSingle();

  return { database, data, error };
}

export async function requestRegisterCodeAction(
  _previousState: AuthActionState = initialAuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  void _previousState;

  const parsed = registerRequestSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone")
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте поля." };
  }

  if (!isChecked(formData.get("personal_data_consent"))) {
    return { status: "error", message: "Нужно дать согласие на обработку персональных данных." };
  }

  const code = createVerificationCode();
  const normalizedPhone = normalizePhone(parsed.data.phone);
  const limit = await checkAuthRateLimit("send_code", normalizedPhone);

  if (!limit.allowed) {
    return { status: "error", message: limit.message ?? "Слишком много попыток.", phone: normalizedPhone, name: parsed.data.name };
  }

  await recordAuthFailure("send_code", normalizedPhone);
  const saved = await saveVerificationCode(normalizedPhone, code);

  if (!saved.ok) {
    return { status: "error", message: saved.message, phone: normalizedPhone, name: parsed.data.name };
  }

  return {
    status: "code_sent",
    message: saved.message,
    phone: normalizedPhone,
    name: parsed.data.name
  };
}

export async function registerWithPasswordAction(
  _previousState: AuthActionState = initialAuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  void _previousState;

  const parsed = passwordRegisterSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    password_confirm: formData.get("password_confirm"),
    redirectTo: formData.get("redirectTo"),
    next: formData.get("next")
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте поля." };
  }

  if (!isChecked(formData.get("personal_data_consent"))) {
    return { status: "error", message: "Нужно дать согласие на обработку персональных данных." };
  }

  const database = createDatabaseServerClient();

  if (!database) {
    return { status: "error", message: "База данных не подключена." };
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const limit = await checkAuthRateLimit("customer_register", normalizedPhone);

  if (!limit.allowed) {
    return { status: "error", message: limit.message ?? "Слишком много попыток.", phone: normalizedPhone, name: parsed.data.name };
  }

  const { data: existingCustomer } = await database
    .from("customers")
    .select("id")
    .in("phone", getPhoneLookupCandidates(parsed.data.phone))
    .limit(1)
    .maybeSingle();

  if (existingCustomer) {
    await recordAuthFailure("customer_register", normalizedPhone);
    return {
      status: "error",
      message: "Профиль с таким телефоном уже есть. Войдите или используйте вход по коду.",
      phone: normalizedPhone,
      name: parsed.data.name
    };
  }

  const { data, error } = await database
    .from("customers")
    .insert({
      name: parsed.data.name,
      phone: normalizedPhone,
      password_hash: hashPassword(parsed.data.password),
      last_login_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (error || !data) {
    await recordAuthFailure("customer_register", normalizedPhone);
    return { status: "error", message: "Не удалось создать профиль.", phone: normalizedPhone, name: parsed.data.name };
  }

  const customerId = String(data.id);
  const consents = await saveRegistrationConsents(customerId, formData, "/register");

  if (!consents.ok) {
    await database.from("customers").delete().eq("id", customerId);
    return { status: "error", message: consents.message, phone: normalizedPhone, name: parsed.data.name };
  }

  if (isChecked(formData.get("loyalty_consent"))) {
    await ensureLoyaltyAccount(customerId);
  }
  await clearAuthFailures("customer_register", normalizedPhone);
  await writeAuditLog({
    action: "customer.register",
    actorId: customerId,
    actorRefHash: hashPrivacyValue(normalizedPhone),
    actorType: "customer",
    entityId: customerId,
    entityType: "customer",
    sourcePath: "/register"
  });
  await setCustomerSession(customerId);
  redirect(getRedirectPath(parsed.data.redirectTo, parsed.data.next));
}

export async function confirmRegisterAction(
  _previousState: AuthActionState = initialAuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  void _previousState;

  const parsed = registerConfirmSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    code: formData.get("code"),
    redirectTo: formData.get("redirectTo"),
    next: formData.get("next")
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте поля." };
  }

  if (!isChecked(formData.get("personal_data_consent"))) {
    return { status: "error", message: "Нужно дать согласие на обработку персональных данных." };
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const limit = await checkAuthRateLimit("verify_code", normalizedPhone);

  if (!limit.allowed) {
    return { status: "error", message: limit.message ?? "Слишком много попыток.", phone: normalizedPhone, name: parsed.data.name };
  }
  const verification = await verifyCode(normalizedPhone, parsed.data.code);

  if (!verification.ok) {
    await recordAuthFailure("verify_code", normalizedPhone);
    await writeAuditLog({
      action: "customer.register_code_failed",
      actorRefHash: hashPrivacyValue(normalizedPhone),
      actorType: "customer",
      sourcePath: "/register"
    });
    return { status: "error", message: verification.message, phone: normalizedPhone, name: parsed.data.name };
  }

  const database = createDatabaseServerClient();

  if (!database) {
    return { status: "error", message: "База данных не подключена.", phone: normalizedPhone, name: parsed.data.name };
  }

  const { data, error } = await database
    .from("customers")
    .upsert(
      {
        name: parsed.data.name,
        phone: normalizedPhone,
        last_login_at: new Date().toISOString()
      },
      { onConflict: "phone" }
    )
    .select("id")
    .single();

  if (error || !data) {
    return { status: "error", message: "Не удалось создать профиль.", phone: normalizedPhone, name: parsed.data.name };
  }

  const customerId = String(data.id);
  const consents = await saveRegistrationConsents(customerId, formData, "/register");

  if (!consents.ok) {
    return { status: "error", message: consents.message, phone: normalizedPhone, name: parsed.data.name };
  }

  if (isChecked(formData.get("loyalty_consent"))) {
    await ensureLoyaltyAccount(customerId);
  }
  await clearAuthFailures("verify_code", normalizedPhone);
  await writeAuditLog({
    action: "customer.register",
    actorId: customerId,
    actorRefHash: hashPrivacyValue(normalizedPhone),
    actorType: "customer",
    entityId: customerId,
    entityType: "customer",
    sourcePath: "/register"
  });
  await setCustomerSession(customerId);
  redirect(getRedirectPath(parsed.data.redirectTo, parsed.data.next));
}

export async function requestLoginCodeAction(
  _previousState: AuthActionState = initialAuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  void _previousState;

  const parsed = loginRequestSchema.safeParse({
    phone: formData.get("phone")
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте телефон." };
  }

  const database = createDatabaseServerClient();

  if (!database) {
    return { status: "error", message: "База данных не подключена." };
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const limit = await checkAuthRateLimit("send_code", normalizedPhone);

  if (!limit.allowed) {
    return { status: "error", message: limit.message ?? "Слишком много попыток.", phone: normalizedPhone };
  }
  const { data, error } = await database
    .from("customers")
    .select("id")
    .in("phone", getPhoneLookupCandidates(parsed.data.phone))
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { status: "error", message: "Профиль не найден. Зарегистрируйтесь.", phone: normalizedPhone };
  }

  const code = createVerificationCode();
  await recordAuthFailure("send_code", normalizedPhone);
  const saved = await saveVerificationCode(normalizedPhone, code);

  if (!saved.ok) {
    return { status: "error", message: saved.message, phone: normalizedPhone };
  }

  return {
    status: "code_sent",
    message: saved.message,
    phone: normalizedPhone
  };
}

export async function loginWithPasswordAction(
  _previousState: AuthActionState = initialAuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  void _previousState;

  const parsed = passwordLoginSchema.safeParse({
    phone: formData.get("phone"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo"),
    next: formData.get("next")
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте поля." };
  }

  const { database, data, error } = await findCustomerForLogin(parsed.data.phone);

  if (!database) {
    return { status: "error", message: "База данных не подключена." };
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const limit = await checkAuthRateLimit("customer_login", normalizedPhone);

  if (!limit.allowed) {
    return { status: "error", message: limit.message ?? "Слишком много попыток.", phone: normalizedPhone };
  }
  if (error || !data) {
    await recordAuthFailure("customer_login", normalizedPhone);
    return { status: "error", message: "Профиль не найден. Зарегистрируйтесь.", phone: normalizedPhone };
  }

  if (!data.password_hash) {
    await recordAuthFailure("customer_login", normalizedPhone);
    return {
      status: "error",
      message: "Для входа по паролю зарегистрируйтесь заново или используйте вход по коду.",
      phone: normalizedPhone
    };
  }

  if (!verifyPassword(parsed.data.password, String(data.password_hash))) {
    await recordAuthFailure("customer_login", normalizedPhone);
    await writeAuditLog({
      action: "customer.login_failed",
      actorRefHash: hashPrivacyValue(normalizedPhone),
      actorType: "customer",
      sourcePath: "/login"
    });
    return { status: "error", message: "Неверный телефон или пароль.", phone: normalizedPhone };
  }

  await clearAuthFailures("customer_login", normalizedPhone);
  await database.from("customers").update({ last_login_at: new Date().toISOString() }).eq("id", data.id);
  await writeAuditLog({
    action: "customer.login",
    actorId: String(data.id),
    actorRefHash: hashPrivacyValue(normalizedPhone),
    actorType: "customer",
    entityId: String(data.id),
    entityType: "customer",
    sourcePath: "/login"
  });
  await setCustomerSession(String(data.id));
  redirect(getRedirectPath(parsed.data.redirectTo, parsed.data.next));
}

export async function confirmLoginAction(
  _previousState: AuthActionState = initialAuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  void _previousState;

  const parsed = loginConfirmSchema.safeParse({
    phone: formData.get("phone"),
    code: formData.get("code"),
    redirectTo: formData.get("redirectTo"),
    next: formData.get("next")
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте поля." };
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const limit = await checkAuthRateLimit("verify_code", normalizedPhone);

  if (!limit.allowed) {
    return { status: "error", message: limit.message ?? "Слишком много попыток.", phone: normalizedPhone };
  }
  const verification = await verifyCode(normalizedPhone, parsed.data.code);

  if (!verification.ok) {
    await recordAuthFailure("verify_code", normalizedPhone);
    await writeAuditLog({
      action: "customer.login_code_failed",
      actorRefHash: hashPrivacyValue(normalizedPhone),
      actorType: "customer",
      sourcePath: "/login"
    });
    return { status: "error", message: verification.message, phone: normalizedPhone };
  }

  const database = createDatabaseServerClient();

  if (!database) {
    return { status: "error", message: "База данных не подключена.", phone: normalizedPhone };
  }

  const { data, error } = await database
    .from("customers")
    .select("id")
    .in("phone", getPhoneLookupCandidates(parsed.data.phone))
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { status: "error", message: "Профиль не найден. Зарегистрируйтесь.", phone: normalizedPhone };
  }

  await clearAuthFailures("verify_code", normalizedPhone);
  await database.from("customers").update({ last_login_at: new Date().toISOString() }).eq("id", data.id);
  await writeAuditLog({
    action: "customer.login",
    actorId: String(data.id),
    actorRefHash: hashPrivacyValue(normalizedPhone),
    actorType: "customer",
    entityId: String(data.id),
    entityType: "customer",
    sourcePath: "/login"
  });
  await setCustomerSession(String(data.id));
  redirect(getRedirectPath(parsed.data.redirectTo, parsed.data.next));
}
