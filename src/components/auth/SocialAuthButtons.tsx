"use client";

import { useCallback, useState } from "react";
import { MaxLoginButton } from "@/components/auth/MaxLoginButton";
import { TelegramLoginButton } from "@/components/auth/TelegramLoginButton";

type SocialAuthButtonsProps = {
  enabled: { telegram: boolean; max: boolean };
  onProviderStart?: (provider: "telegram" | "max") => void;
  returnTo?: string;
};

export function SocialAuthButtons({ enabled, onProviderStart, returnTo }: SocialAuthButtonsProps) {
  const hasProviders = enabled.telegram || enabled.max;
  const [activeProvider, setActiveProvider] = useState<"telegram" | "max" | null>(null);

  const handleProviderStart = useCallback((provider: "telegram" | "max") => {
    setActiveProvider(provider);
    onProviderStart?.(provider);
  }, [onProviderStart]);

  if (!hasProviders) return null;

  return (
    <section className="mt-6" aria-label="Быстрый вход">
      <div className="grid gap-3">
        {enabled.telegram ? (
          <TelegramLoginButton
            onAttemptStart={() => handleProviderStart("telegram")}
            returnTo={returnTo || "/profile"}
            suppressTransientError={activeProvider === "max"}
          />
        ) : null}

        {enabled.max ? (
          <MaxLoginButton
            onAttemptStart={() => handleProviderStart("max")}
            returnTo={returnTo || "/profile"}
            suppressTransientError={activeProvider === "telegram"}
          />
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
