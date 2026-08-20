"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useActionState, useState } from "react";
import { PhoneInput } from "@/components/forms/PhoneInput";
import {
  completeSocialPhoneAction,
  initialSocialCompleteState,
  requestSocialPhoneCodeAction
} from "@/app/login/social/complete/actions";
import { SocialProviderIcon } from "@/components/auth/SocialProviderIcon";
import type { SocialProvider } from "@/lib/auth/social/types";

export function SocialCompleteForm({ provider, suggestedName }: { provider: SocialProvider; suggestedName: string }) {
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [requestState, requestAction, requestPending] = useActionState(requestSocialPhoneCodeAction, initialSocialCompleteState);
  const [confirmState, confirmAction, confirmPending] = useActionState(completeSocialPhoneAction, initialSocialCompleteState);
  const phone = confirmState.phone || requestState.phone || "";
  const name = confirmState.name || requestState.name || suggestedName;
  const codeSent = requestState.status === "code_sent" || Boolean(confirmState.phone);
  const message = confirmState.message || requestState.message;
  const isError = confirmState.status === "error" || (confirmState.status === "idle" && requestState.status === "error");
  const providerName = provider === "telegram" ? "Telegram" : "MAX";

  return (
    <section className="rounded-lg border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.10)] sm:p-8">
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 items-center justify-center rounded-full text-white ${provider === "telegram" ? "bg-[#229ED9]" : "bg-[#471AFF]"}`}>
          <SocialProviderIcon provider={provider} className="h-6 w-6" />
        </span>
        <p className="text-xs font-black uppercase text-karimoff-orange">{providerName} · ещё один шаг</p>
      </div>
      <h1 className="mt-5 text-3xl font-black leading-tight">Завершим вход</h1>
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        {provider === "telegram"
          ? "Telegram не передал номер телефона. Попробуйте ещё раз или используйте другой способ входа."
          : "MAX не передал подтверждённый номер телефона. Завершите вход по SMS."}
      </div>
      <div className="mt-4 flex items-start gap-3 text-sm leading-6 text-karimoff-muted">
        <ShieldCheck className="mt-0.5 shrink-0 text-karimoff-orange" size={19} />
        <p>Подтвердите номер по SMS, чтобы безопасно завершить вход. По имени или username аккаунты не объединяются.</p>
      </div>
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
          {requestPending ? "Отправляем" : codeSent ? "Отправить код ещё раз" : "Получить код по SMS"}
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

      {message ? <p role={isError ? "alert" : "status"} className={`mt-5 rounded-lg px-4 py-3 text-sm font-semibold ${isError ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{message}</p> : null}
      <p className="mt-5 text-center text-xs leading-5 text-karimoff-muted">
        Не хотите продолжать? <Link href="/login" className="font-bold text-karimoff-orange">Выберите другой способ входа</Link>
      </p>
    </section>
  );
}
