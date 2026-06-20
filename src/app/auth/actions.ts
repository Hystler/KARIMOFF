"use server";

import { redirect } from "next/navigation";
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
import { hashPassword, verifyPassword } from "@/lib/password-auth";
import { sendVerificationCode } from "@/lib/verification/send-code";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function saveVerificationCode(phone: string, code: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { ok: false, message: "Supabase не подключён." };
  }

  const normalizedPhone = normalizePhone(phone);
  const { error } = await supabase.from("verification_codes").insert({
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
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { ok: false, message: "Supabase не подключён." };
  }

  const normalizedPhone = normalizePhone(phone);
  const { data, error } = await supabase
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

  const { error: updateError } = await supabase
    .from("verification_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data.id);

  if (updateError) {
    return { ok: false, message: "Не удалось подтвердить код." };
  }

  return { ok: true, message: "" };
}

function getNextPath(next?: string | null) {
  if (next === "checkout") {
    return "/?checkout=1";
  }

  return "/";
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

  const code = createVerificationCode();
  const normalizedPhone = normalizePhone(parsed.data.phone);
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
    next: formData.get("next")
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте поля." };
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { status: "error", message: "Supabase не подключён." };
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const { data: existingCustomer } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (existingCustomer) {
    return {
      status: "error",
      message: "Профиль с таким телефоном уже есть. Войдите или используйте вход по коду.",
      phone: normalizedPhone,
      name: parsed.data.name
    };
  }

  const { data, error } = await supabase
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
    return { status: "error", message: "Не удалось создать профиль.", phone: normalizedPhone, name: parsed.data.name };
  }

  await ensureLoyaltyAccount(String(data.id));
  await setCustomerSession(String(data.id));
  redirect(getNextPath(parsed.data.next));
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
    next: formData.get("next")
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте поля." };
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const verification = await verifyCode(normalizedPhone, parsed.data.code);

  if (!verification.ok) {
    return { status: "error", message: verification.message, phone: normalizedPhone, name: parsed.data.name };
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { status: "error", message: "Supabase не подключён.", phone: normalizedPhone, name: parsed.data.name };
  }

  const { data, error } = await supabase
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

  await ensureLoyaltyAccount(String(data.id));
  await setCustomerSession(String(data.id));
  redirect(getNextPath(parsed.data.next));
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

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { status: "error", message: "Supabase не подключён." };
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (error || !data) {
    return { status: "error", message: "Профиль не найден. Зарегистрируйтесь.", phone: normalizedPhone };
  }

  const code = createVerificationCode();
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
    next: formData.get("next")
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте поля." };
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { status: "error", message: "Supabase не подключён." };
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const { data, error } = await supabase
    .from("customers")
    .select("id, password_hash")
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (error || !data) {
    return { status: "error", message: "Профиль не найден. Зарегистрируйтесь.", phone: normalizedPhone };
  }

  if (!data.password_hash) {
    return {
      status: "error",
      message: "Для входа по паролю зарегистрируйтесь заново или используйте вход по коду.",
      phone: normalizedPhone
    };
  }

  if (!verifyPassword(parsed.data.password, String(data.password_hash))) {
    return { status: "error", message: "Неверный телефон или пароль.", phone: normalizedPhone };
  }

  await supabase.from("customers").update({ last_login_at: new Date().toISOString() }).eq("id", data.id);
  await ensureLoyaltyAccount(String(data.id));
  await setCustomerSession(String(data.id));
  redirect(getNextPath(parsed.data.next));
}

export async function confirmLoginAction(
  _previousState: AuthActionState = initialAuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  void _previousState;

  const parsed = loginConfirmSchema.safeParse({
    phone: formData.get("phone"),
    code: formData.get("code"),
    next: formData.get("next")
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте поля." };
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const verification = await verifyCode(normalizedPhone, parsed.data.code);

  if (!verification.ok) {
    return { status: "error", message: verification.message, phone: normalizedPhone };
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { status: "error", message: "Supabase не подключён.", phone: normalizedPhone };
  }

  const { data, error } = await supabase
    .from("customers")
    .update({ last_login_at: new Date().toISOString() })
    .eq("phone", normalizedPhone)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { status: "error", message: "Профиль не найден. Зарегистрируйтесь.", phone: normalizedPhone };
  }

  await ensureLoyaltyAccount(String(data.id));
  await setCustomerSession(String(data.id));
  redirect(getNextPath(parsed.data.next));
}
