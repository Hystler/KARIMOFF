import "server-only";

import {
  createVerificationCode,
  getVerificationExpiresAt,
  hashVerificationCode,
  normalizePhone
} from "@/lib/customer-auth";
import { createDatabaseServerClient } from "@/lib/database/server";
import { getPostgresSql } from "@/lib/postgres/server";
import { sendVerificationCode } from "./send-code";

export async function issueCustomerVerificationCode(phone: string) {
  const database = createDatabaseServerClient();
  if (!database) return { ok: false as const, message: "База данных не подключена." };
  const normalizedPhone = normalizePhone(phone);
  const code = createVerificationCode();
  const { data, error } = await database
    .from("verification_codes")
    .insert({
      phone: normalizedPhone,
      code_hash: hashVerificationCode(normalizedPhone, code),
      expires_at: getVerificationExpiresAt()
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false as const, message: "Не удалось сохранить код подтверждения." };

  const sent = await sendVerificationCode(normalizedPhone, code);
  if (!sent.ok) {
    await database
      .from("verification_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", data.id);
    return { ok: false as const, message: "Сервис отправки кода пока не настроен." };
  }

  return { ok: true as const, message: "Код отправлен." };
}

export async function consumeCustomerVerificationCode(phone: string, code: string) {
  const normalizedPhone = normalizePhone(phone);
  const sql = getPostgresSql();
  const [used] = await sql<{ id: string }[]>`
    update public.verification_codes
    set used_at = now()
    where id = (
      select id
      from public.verification_codes
      where phone = ${normalizedPhone}
        and code_hash = ${hashVerificationCode(normalizedPhone, code)}
        and used_at is null
        and expires_at > now()
      order by created_at desc
      limit 1
      for update skip locked
    )
    returning id
  `;

  return used
    ? { ok: true as const, message: "" }
    : { ok: false as const, message: "Код неверен, уже использован или истёк." };
}
