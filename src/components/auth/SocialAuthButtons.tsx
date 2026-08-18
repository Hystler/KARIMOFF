"use client";

import { useState } from "react";

type SocialAuthButtonsProps = {
  enabled: { telegram: boolean; vk: boolean };
  returnTo?: string;
};

export function SocialAuthButtons({ enabled, returnTo }: SocialAuthButtonsProps) {
  const [pending, setPending] = useState<"telegram" | "vk" | null>(null);
  const providers = [
    { id: "telegram" as const, label: "Войти через Telegram", mark: "T", className: "border-[#2AABEE]/35 hover:border-[#2AABEE] hover:bg-[#F2FAFE]" },
    { id: "vk" as const, label: "Войти через VK ID", mark: "VK", className: "border-[#0077FF]/30 hover:border-[#0077FF] hover:bg-[#F2F7FF]" }
  ].filter((provider) => enabled[provider.id]);

  if (!providers.length) return null;

  return (
    <div className="mt-6">
      <div className="grid gap-3">
        {providers.map((provider) => {
          const href = `/api/auth/social/${provider.id}/start${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
          return (
            <a
              key={provider.id}
              href={href}
              onClick={() => setPending(provider.id)}
              aria-busy={pending === provider.id}
              className={`flex min-h-[52px] items-center justify-center gap-3 rounded-lg border bg-white px-5 text-sm font-bold text-karimoff-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange ${provider.className}`}
            >
              <span aria-hidden="true" className="flex h-7 min-w-7 items-center justify-center rounded-full bg-karimoff-black px-1 text-[10px] font-black text-white">
                {provider.mark}
              </span>
              {pending === provider.id ? "Открываем безопасный вход" : provider.label}
            </a>
          );
        })}
      </div>
      <div className="mt-6 flex items-center gap-3 text-xs font-bold uppercase text-karimoff-muted/70" aria-hidden="true">
        <span className="h-px flex-1 bg-karimoff-line" />
        или
        <span className="h-px flex-1 bg-karimoff-line" />
      </div>
    </div>
  );
}
