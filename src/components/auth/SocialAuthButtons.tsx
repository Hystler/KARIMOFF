"use client";

import { LoaderCircle } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { SocialProviderIcon } from "@/components/auth/SocialProviderIcon";
import { TelegramLoginButton } from "@/components/auth/TelegramLoginButton";

type SocialAuthButtonsProps = {
  enabled: { telegram: boolean; vk: boolean };
  returnTo?: string;
};

export function SocialAuthButtons({ enabled, returnTo }: SocialAuthButtonsProps) {
  const [pending, setPending] = useState<"vk" | null>(null);
  const hasProviders = enabled.telegram || enabled.vk;

  if (!hasProviders) return null;

  function handleProviderClick(event: MouseEvent<HTMLAnchorElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    setPending("vk");
  }

  return (
    <section className="mt-6" aria-label="Быстрый вход">
      <div className="grid gap-3">
        {enabled.telegram ? (
          <TelegramLoginButton
            returnTo={returnTo || "/profile"}
          />
        ) : null}

        {enabled.vk ? (
          <a
            href={`/api/auth/social/vk/start${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
            onClick={handleProviderClick}
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

      <div className="mt-6 flex items-center gap-3 text-xs font-bold uppercase text-karimoff-muted/70" aria-hidden="true">
        <span className="h-px flex-1 bg-karimoff-line" />
        или
        <span className="h-px flex-1 bg-karimoff-line" />
      </div>
    </section>
  );
}
