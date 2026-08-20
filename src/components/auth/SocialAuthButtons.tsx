"use client";

import { MaxLoginButton } from "@/components/auth/MaxLoginButton";
import { TelegramLoginButton } from "@/components/auth/TelegramLoginButton";

type SocialAuthButtonsProps = {
  enabled: { telegram: boolean; max: boolean };
  returnTo?: string;
};

export function SocialAuthButtons({ enabled, returnTo }: SocialAuthButtonsProps) {
  const hasProviders = enabled.telegram || enabled.max;

  if (!hasProviders) return null;

  return (
    <section className="mt-6" aria-label="Быстрый вход">
      <div className="grid gap-3">
        {enabled.telegram ? (
          <TelegramLoginButton
            returnTo={returnTo || "/profile"}
          />
        ) : null}

        {enabled.max ? (
          <MaxLoginButton returnTo={returnTo || "/profile"} />
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
