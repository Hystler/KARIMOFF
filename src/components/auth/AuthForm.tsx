"use client";

import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";

type AuthFormProps = {
  mode: "login" | "register";
  next?: string;
  redirectTo?: string;
  socialProviders?: { telegram: boolean; max: boolean };
  socialError?: string | null;
};

export function AuthForm({ mode, next, redirectTo, socialProviders = { telegram: false, max: false }, socialError }: AuthFormProps) {
  const [visibleSocialError, setVisibleSocialError] = useState(socialError ?? null);
  const available = socialProviders.telegram || socialProviders.max;
  useEffect(() => {
    if (!socialError) return;
    const currentUrl = new URL(window.location.href);
    if (!currentUrl.searchParams.has("socialError")) return;
    currentUrl.searchParams.delete("socialError");
    window.history.replaceState(window.history.state, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  }, [socialError]);
  return <section className="rounded-lg border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.10)] sm:p-8">
    <h1 className="text-3xl font-black leading-tight text-karimoff-black">{mode === "register" ? "Создать профиль" : "Вход"}</h1>
    <p className="mt-4 text-sm leading-6 text-karimoff-muted">{available ? "Войдите через удобный мессенджер. Для нового гостя профиль создастся после подтверждения номера." : "Вход через мессенджеры временно недоступен. Попробуйте позже."}</p>
    <SocialAuthButtons enabled={socialProviders} onProviderStart={() => setVisibleSocialError(null)}
      returnTo={redirectTo || (next === "checkout" ? "/checkout" : "/profile")} />
    {visibleSocialError ? <div role="alert" className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold leading-6 text-red-700"><CircleAlert className="mt-0.5 shrink-0" size={18} />{visibleSocialError}</div> : null}
    <p className="mt-6 text-xs leading-5 text-karimoff-muted">Данные аккаунта используются для входа и оформления заказов. <Link href="/legal/privacy" className="underline underline-offset-2">Политика конфиденциальности</Link></p>
  </section>;
}
