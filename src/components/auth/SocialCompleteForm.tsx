"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { PhoneInput } from "@/components/forms/PhoneInput";
import {
  completeSocialPhoneAction,
  initialSocialCompleteState,
  requestSocialPhoneCodeAction
} from "@/app/login/social/complete/actions";

export function SocialCompleteForm({ providerName, suggestedName }: { providerName: string; suggestedName: string }) {
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [requestState, requestAction, requestPending] = useActionState(requestSocialPhoneCodeAction, initialSocialCompleteState);
  const [confirmState, confirmAction, confirmPending] = useActionState(completeSocialPhoneAction, initialSocialCompleteState);
  const phone = confirmState.phone || requestState.phone || "";
  const name = confirmState.name || requestState.name || suggestedName;
  const codeSent = requestState.status === "code_sent" || Boolean(confirmState.phone);
  const message = confirmState.message || requestState.message;
  const isError = confirmState.status === "error" || (confirmState.status === "idle" && requestState.status === "error");

  return (
    <section className="rounded-lg border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.10)] sm:p-8">
      <p className="text-xs font-black uppercase text-karimoff-orange">{providerName}</p>
      <h1 className="mt-3 text-3xl font-black leading-tight">Подтвердите телефон</h1>
      <p className="mt-4 text-sm leading-6 text-karimoff-muted">
        Телефон нужен для заказов и безопасного объединения профилей. По имени аккаунты не связываются.
      </p>
      <form action={requestAction} className="mt-7 grid gap-4">
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-karimoff-muted">Имя</span>
          <input name="name" required defaultValue={name} className="h-[52px] rounded-lg border border-karimoff-line px-4 outline-none focus:border-karimoff-orange" />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-karimoff-muted">Телефон</span>
          <PhoneInput name="phone" required defaultValue={phone} className="h-[52px] rounded-lg border border-karimoff-line px-4 outline-none focus:border-karimoff-orange" />
        </label>
        <label className="flex items-start gap-3 text-sm leading-6 text-karimoff-muted">
          <input type="checkbox" name="personal_data_consent" required checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 h-5 w-5 accent-karimoff-orange" />
          <span>
            Я даю согласие на обработку персональных данных.{" "}
            <Link href="/legal/personal-data-consent" target="_blank" className="font-bold text-karimoff-orange">Текст согласия</Link>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm leading-6 text-karimoff-muted">
          <input type="checkbox" name="marketing_consent" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} className="mt-1 h-5 w-5 accent-karimoff-orange" />
          Хочу получать акции и предложения KARIMOFF
        </label>
        <button type="submit" disabled={requestPending || !consent} className="min-h-12 rounded-full bg-karimoff-orange px-6 py-3 text-sm font-bold text-white transition hover:bg-[#D95405] disabled:opacity-60">
          {requestPending ? "Отправляем" : codeSent ? "Отправить код ещё раз" : "Получить код"}
        </button>
      </form>

      {codeSent ? (
        <form action={confirmAction} className="mt-5 grid gap-4 border-t border-karimoff-line pt-5">
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="personal_data_consent" value={consent ? "on" : ""} />
          <input type="hidden" name="marketing_consent" value={marketing ? "on" : ""} />
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Код из SMS</span>
            <input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className="h-[52px] rounded-lg border border-karimoff-line px-4 outline-none focus:border-karimoff-orange" placeholder="6 цифр" />
          </label>
          <button type="submit" disabled={confirmPending} className="min-h-12 rounded-full bg-karimoff-black px-6 py-3 text-sm font-bold text-white transition hover:bg-black disabled:opacity-60">
            {confirmPending ? "Проверяем" : "Завершить вход"}
          </button>
        </form>
      ) : null}

      {message ? <p className={`mt-5 text-sm font-semibold ${isError ? "text-red-600" : "text-karimoff-orange"}`}>{message}</p> : null}
    </section>
  );
}
