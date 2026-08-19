"use client";

import Link from "next/link";
import { Check, CircleAlert, LoaderCircle, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { SocialProviderIcon } from "@/components/auth/SocialProviderIcon";
import type { SocialProvider } from "@/lib/auth/social/types";

type SocialAuthResultProps = {
  status: "success" | "error";
  provider: SocialProvider;
  returnTo: string;
  reason?: string | null;
  linked?: boolean;
};

const errorMessages: Record<string, string> = {
  cancelled: "Вы отменили вход через Telegram.",
  validation_failed: "Не удалось подтвердить вход через Telegram. Попробуйте ещё раз.",
  missing_phone: "Telegram не передал номер телефона. Вы можете подтвердить номер другим способом.",
  expired: "Время подтверждения истекло. Попробуйте ещё раз.",
  link_conflict: "Этот Telegram уже связан с другим аккаунтом.",
  technical: "Не удалось завершить вход. Попробуйте ещё раз.",
  session_expired: "Время безопасного входа истекло. Начните ещё раз.",
  unavailable: "Вход через Telegram сейчас недоступен. Используйте телефон или попробуйте позже.",
  rate_limit: "Слишком много попыток входа. Подождите немного и попробуйте ещё раз.",
  start_failed: "Не удалось завершить вход. Попробуйте позже."
};

function providerName(provider: SocialProvider) {
  return provider === "telegram" ? "Telegram" : "VK ID";
}

function getErrorMessage(provider: SocialProvider, reason?: string | null) {
  if (provider === "telegram") return errorMessages[reason ?? ""] ?? "Не удалось завершить вход. Попробуйте позже.";
  if (reason === "cancelled") return "Вы отменили вход через VK ID.";
  return "Не удалось подтвердить вход через VK ID. Попробуйте ещё раз.";
}

export function SocialAuthResult({ status, provider, returnTo, reason, linked = false }: SocialAuthResultProps) {
  const [seconds, setSeconds] = useState(2);
  const isCheckout = returnTo.startsWith("/checkout");
  const retryHref = `/api/auth/social/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`;
  const loginHref = `/login?redirectTo=${encodeURIComponent(returnTo)}`;

  useEffect(() => {
    if (status !== "success") return;
    const interval = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1_000);
    const redirectTimer = window.setTimeout(() => window.location.replace(returnTo), 1_650);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(redirectTimer);
    };
  }, [returnTo, status]);

  return (
    <section className="overflow-hidden rounded-lg border border-karimoff-line bg-white shadow-[0_28px_80px_rgba(18,18,20,0.12)]">
      <div className={`h-1.5 w-full ${status === "success" ? "bg-emerald-500" : "bg-red-500"}`} />
      <div className="p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div className={`flex h-14 w-14 items-center justify-center rounded-full ${provider === "telegram" ? "bg-[#229ED9] text-white" : "bg-[#0077FF] text-white"}`}>
            <SocialProviderIcon provider={provider} className="h-7 w-7" />
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${status === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {status === "success" ? <Check size={22} strokeWidth={2.5} /> : <CircleAlert size={22} />}
          </div>
        </div>

        {status === "success" ? (
          <>
            <p className="mt-7 text-xs font-black uppercase text-emerald-700">{providerName(provider)} · безопасный вход</p>
            <h1 className="mt-3 text-3xl font-black leading-tight text-karimoff-black">{linked ? `${providerName(provider)} подключён` : "Вход подтверждён"}</h1>
            <p className="mt-4 text-sm leading-6 text-karimoff-muted">
              {linked
                ? `Аккаунт ${providerName(provider)} теперь привязан к вашему профилю KARIMOFF.`
                : `Вы вошли через ${providerName(provider)}.`}
            </p>
            <p className="mt-1 text-sm leading-6 text-karimoff-muted">
              {isCheckout ? "Возвращаем вас к оформлению заказа…" : "Возвращаем вас в KARIMOFF…"}
            </p>
            <div className="mt-6 flex items-center gap-3 rounded-lg bg-karimoff-soft px-4 py-3 text-sm font-semibold text-karimoff-muted" role="status" aria-live="polite">
              <LoaderCircle className="shrink-0 animate-spin text-karimoff-orange" size={19} />
              Переходим {seconds > 0 ? `через ${seconds} сек.` : "сейчас"}
            </div>
            <a href={returnTo} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-karimoff-orange px-5 py-3 text-sm font-black text-white shadow-[0_14px_30px_rgba(251,103,10,0.22)] transition hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange">
              Вернуться в KARIMOFF
            </a>
          </>
        ) : (
          <>
            <p className="mt-7 text-xs font-black uppercase text-red-700">{providerName(provider)} · вход не завершён</p>
            <h1 className="mt-3 text-3xl font-black leading-tight text-karimoff-black">Давайте попробуем ещё раз</h1>
            <p className="mt-4 text-sm leading-6 text-karimoff-muted">{getErrorMessage(provider, reason)}</p>
            <div className="mt-6 flex items-start gap-3 rounded-lg border border-karimoff-line bg-karimoff-soft/70 p-4 text-sm leading-6 text-karimoff-muted">
              <ShieldCheck className="mt-0.5 shrink-0 text-karimoff-orange" size={19} />
              Ваш профиль не изменился. KARIMOFF не получил доступ к переписке и ничего не публикует от вашего имени.
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <a href={retryHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-karimoff-orange px-5 py-3 text-sm font-black text-white transition hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange">
                <RotateCcw size={18} />
                Попробовать снова
              </a>
              <Link href={loginHref} className="inline-flex min-h-12 items-center justify-center rounded-lg border border-karimoff-line bg-white px-5 py-3 text-sm font-bold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange">
                Вернуться ко входу
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
