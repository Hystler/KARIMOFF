"use client";

import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  loginWithPasswordAction,
  registerWithPasswordAction
} from "@/app/auth/actions";
import { PhoneInput } from "@/components/forms/PhoneInput";
import { AuthDocumentLink } from "@/components/auth/AuthDocumentLink";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { initialAuthActionState } from "@/lib/customer-schema";

type AuthFormProps = {
  mode: "login" | "register";
  next?: string;
  redirectTo?: string;
  socialProviders?: { telegram: boolean; max: boolean };
  socialError?: string | null;
};

export function AuthForm({ mode, next, redirectTo, socialProviders = { telegram: false, max: false }, socialError }: AuthFormProps) {
  const isRegister = mode === "register";
  const [personalDataConsent, setPersonalDataConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loyaltyConsent, setLoyaltyConsent] = useState(false);
  const [visibleSocialError, setVisibleSocialError] = useState(socialError ?? null);
  const [passwordState, passwordAction, isPasswordPending] = useActionState(
    isRegister ? registerWithPasswordAction : loginWithPasswordAction,
    initialAuthActionState
  );
  const phone = passwordState.phone || "";
  const name = passwordState.name || "";

  useEffect(() => {
    if (!socialError) return;
    const currentUrl = new URL(window.location.href);
    if (!currentUrl.searchParams.has("socialError")) return;
    currentUrl.searchParams.delete("socialError");
    window.history.replaceState(window.history.state, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  }, [socialError]);

  return (
    <section className="rounded-lg border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.10)] sm:p-8">
      <h1 className="text-3xl font-black leading-tight text-karimoff-black">
        {isRegister ? "Регистрация" : "Вход"}
      </h1>
      <p className="mt-4 text-sm leading-6 text-karimoff-muted">
        {isRegister
          ? "Создайте профиль, чтобы быстро оформлять заказы и копить баллы."
          : socialProviders.telegram || socialProviders.max
            ? "Выберите удобный способ — через мессенджер или по телефону с паролем."
            : "Войдите по телефону и постоянному паролю."}
      </p>

      <SocialAuthButtons
        enabled={socialProviders}
        onProviderStart={() => setVisibleSocialError(null)}
        returnTo={redirectTo || (next === "checkout" ? "/checkout" : "/profile")}
      />
      {visibleSocialError ? (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold leading-6 text-red-700">
          <CircleAlert className="mt-0.5 shrink-0" size={18} />
          {visibleSocialError}
        </div>
      ) : null}

      <form action={passwordAction} className="mt-7 grid gap-4">
        {isRegister ? (
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Имя</span>
            <input
              name="name"
              required
              defaultValue={name}
              className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
              placeholder="Ваше имя"
            />
          </label>
        ) : null}
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-karimoff-muted">Телефон</span>
          <PhoneInput
            name="phone"
            required
            defaultValue={phone}
            className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-karimoff-muted">Пароль</span>
          <input
            name="password"
            required
            type="password"
            minLength={10}
            className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
            placeholder="Минимум 10 символов"
          />
        </label>
        {isRegister ? (
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Повторите пароль</span>
            <input
              name="password_confirm"
              required
              type="password"
              minLength={10}
              className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
              placeholder="Ещё раз, минимум 10 символов"
            />
          </label>
        ) : null}
        {isRegister ? (
          <div className="grid gap-3 rounded-lg border border-karimoff-line bg-karimoff-soft/70 p-4 text-sm">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="personal_data_consent"
                required
                checked={personalDataConsent}
                onChange={(event) => setPersonalDataConsent(event.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-karimoff-orange"
              />
              <span className="leading-6 text-karimoff-muted">
                Я даю согласие на обработку персональных данных.{" "}
                <Link href="/legal/personal-data-consent" target="_blank" className="font-bold text-karimoff-orange">
                  Текст согласия
                </Link>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="loyalty_consent"
                checked={loyaltyConsent}
                onChange={(event) => setLoyaltyConsent(event.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-karimoff-orange"
              />
              <span className="leading-6 text-karimoff-muted">
                Хочу участвовать в KARIMOFF Bonus и принимаю{" "}
                <Link href="/legal/loyalty" target="_blank" className="font-bold text-karimoff-orange">
                  правила программы
                </Link>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="marketing_consent"
                checked={marketingConsent}
                onChange={(event) => setMarketingConsent(event.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-karimoff-orange"
              />
              <span className="leading-6 text-karimoff-muted">
                Хочу получать акции и предложения KARIMOFF.{" "}
                <Link href="/legal/marketing-consent" target="_blank" className="font-bold text-karimoff-orange">
                  Условия
                </Link>
              </span>
            </label>
          </div>
        ) : null}
        <input type="hidden" name="next" value={next ?? ""} />
        <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
        <button
          type="submit"
          disabled={isPasswordPending}
          className="public-button-primary py-3.5"
        >
          {isPasswordPending ? "Проверяем" : isRegister ? "Зарегистрироваться" : "Войти"}
        </button>
      </form>

      {passwordState.message ? (
        <p className={passwordState.status === "error" ? "mt-5 text-sm font-semibold text-red-600" : "mt-5 text-sm font-semibold text-karimoff-orange"}>
          {passwordState.message}
        </p>
      ) : null}

      <div className="mt-6 text-sm text-karimoff-muted">
        {isRegister ? (
          <>
            Уже есть профиль?{" "}
            <AuthDocumentLink href={`/login${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : next ? `?next=${next}` : ""}`} className="font-bold text-karimoff-orange">
              Войти
            </AuthDocumentLink>
          </>
        ) : (
          <>
            Нет профиля?{" "}
            <AuthDocumentLink href={`/register${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : next ? `?next=${next}` : ""}`} className="font-bold text-karimoff-orange">
              Зарегистрироваться
            </AuthDocumentLink>
          </>
        )}
      </div>
    </section>
  );
}
