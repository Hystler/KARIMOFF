"use client";

import { LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { SocialProviderIcon } from "@/components/auth/SocialProviderIcon";

type SocialAuthButtonsProps = {
  enabled: { telegram: boolean; vk: boolean };
  returnTo?: string;
  requestPhone?: boolean;
};

export function SocialAuthButtons({ enabled, returnTo, requestPhone = false }: SocialAuthButtonsProps) {
  const [pending, setPending] = useState<"telegram" | "vk" | null>(null);
  const hasProviders = enabled.telegram || enabled.vk;

  if (!hasProviders) return null;

  function getHref(provider: "telegram" | "vk") {
    return `/api/auth/social/${provider}/start${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  }

  function handleProviderClick(event: MouseEvent<HTMLAnchorElement>, provider: "telegram" | "vk") {
    if (pending) {
      event.preventDefault();
      return;
    }
    setPending(provider);
  }

  return (
    <section className="mt-6" aria-label="Быстрый вход">
      <div className="grid gap-3">
        {enabled.telegram ? (
          <a
            href={getHref("telegram")}
            onClick={(event) => handleProviderClick(event, "telegram")}
            aria-busy={pending === "telegram"}
            aria-disabled={Boolean(pending)}
            className="group flex min-h-[64px] w-full items-center gap-4 rounded-lg bg-[#229ED9] px-4 py-3 text-left text-white shadow-[0_14px_32px_rgba(34,158,217,0.24)] transition hover:-translate-y-0.5 hover:bg-[#188CC4] hover:shadow-[0_18px_38px_rgba(34,158,217,0.30)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229ED9] active:translate-y-0 aria-disabled:pointer-events-none aria-disabled:opacity-70"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
              {pending === "telegram" ? <LoaderCircle className="animate-spin" size={23} /> : <SocialProviderIcon provider="telegram" className="h-6 w-6" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-black leading-5">{pending === "telegram" ? "Открываем Telegram…" : "Войти через Telegram"}</span>
              <span className="mt-0.5 block text-xs font-semibold leading-5 text-white/80">Быстрый вход без ввода пароля</span>
            </span>
          </a>
        ) : null}

        {enabled.vk ? (
          <a
            href={getHref("vk")}
            onClick={(event) => handleProviderClick(event, "vk")}
            aria-busy={pending === "vk"}
            aria-disabled={Boolean(pending)}
            className="flex min-h-[56px] w-full items-center gap-4 rounded-lg border border-[#0077FF]/25 bg-white px-4 py-3 text-left text-karimoff-black transition hover:-translate-y-0.5 hover:border-[#0077FF]/60 hover:bg-[#F3F8FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0077FF] active:translate-y-0 aria-disabled:pointer-events-none aria-disabled:opacity-60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0077FF] text-white">
              {pending === "vk" ? <LoaderCircle className="animate-spin" size={20} /> : <SocialProviderIcon provider="vk" className="h-5 w-5" />}
            </span>
            <span className="text-sm font-black">{pending === "vk" ? "Открываем VK ID…" : "Войти через VK ID"}</span>
          </a>
        ) : null}
      </div>

      {enabled.telegram ? (
        <div className="mt-4 rounded-lg border border-karimoff-line bg-karimoff-soft/70 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 shrink-0 text-[#188CC4]" size={19} />
            <div className="text-[13px] leading-5 text-karimoff-muted">
              <p className="font-bold text-karimoff-black">
                {pending === "telegram"
                  ? "Сейчас откроется окно Telegram для подтверждения входа."
                  : "Вход выполняется через официальный Telegram."}
              </p>
              <p className="mt-1">
                {requestPhone
                  ? "Если вы разрешите доступ, мы получим ваш номер телефона и сможем быстрее оформить ваш профиль."
                  : "Telegram подтвердит ваш профиль. Если номер не будет передан, мы попросим подтвердить его по SMS."}
              </p>
              <p className="mt-1 flex items-center gap-1.5 font-semibold text-karimoff-black/75">
                <LockKeyhole size={13} />
                Мы не публикуем ничего от вашего имени.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-3 text-xs font-bold uppercase text-karimoff-muted/70" aria-hidden="true">
        <span className="h-px flex-1 bg-karimoff-line" />
        или
        <span className="h-px flex-1 bg-karimoff-line" />
      </div>
    </section>
  );
}
