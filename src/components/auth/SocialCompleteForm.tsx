"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { SocialProviderIcon } from "@/components/auth/SocialProviderIcon";
import type { SocialProvider } from "@/lib/auth/social/types";

export function SocialCompleteForm({ provider }: { provider: SocialProvider; suggestedName: string }) {
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
        {providerName} не передал подтверждённый номер телефона. Попробуйте ещё раз и разрешите передачу номера.
      </div>
      <div className="mt-4 flex items-start gap-3 text-sm leading-6 text-karimoff-muted">
        <ShieldCheck className="mt-0.5 shrink-0 text-karimoff-orange" size={19} />
        <p>Без подтверждённого номера новый профиль не объединяется с существующим аккаунтом. По имени или username аккаунты не связываются.</p>
      </div>
      <div className="mt-7 grid gap-3">
        <Link href="/login" className="flex min-h-12 items-center justify-center rounded-full bg-karimoff-orange px-6 py-3 text-sm font-bold text-white transition hover:bg-[#D95405]">
          Попробовать снова
        </Link>
        <Link href="/register" className="flex min-h-12 items-center justify-center rounded-full border border-karimoff-line px-6 py-3 text-sm font-bold text-karimoff-black transition hover:border-karimoff-black/30">
          Создать профиль по телефону
        </Link>
      </div>
    </section>
  );
}
