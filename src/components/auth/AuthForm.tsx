"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  confirmLoginAction,
  confirmRegisterAction,
  loginWithPasswordAction,
  registerWithPasswordAction,
  requestLoginCodeAction,
  requestRegisterCodeAction
} from "@/app/auth/actions";
import { PhoneInput } from "@/components/forms/PhoneInput";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { initialAuthActionState } from "@/lib/customer-schema";

type AuthFormProps = {
  mode: "login" | "register";
  next?: string;
  redirectTo?: string;
  socialProviders?: { telegram: boolean; vk: boolean };
  socialError?: string | null;
};

export function AuthForm({ mode, next, redirectTo, socialProviders = { telegram: false, vk: false }, socialError }: AuthFormProps) {
  const isRegister = mode === "register";
  const [codeMode, setCodeMode] = useState(false);
  const [personalDataConsent, setPersonalDataConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loyaltyConsent, setLoyaltyConsent] = useState(false);
  const [passwordState, passwordAction, isPasswordPending] = useActionState(
    isRegister ? registerWithPasswordAction : loginWithPasswordAction,
    initialAuthActionState
  );
  const [requestState, requestAction, isRequestPending] = useActionState(
    isRegister ? requestRegisterCodeAction : requestLoginCodeAction,
    initialAuthActionState
  );
  const [confirmState, confirmAction, isConfirmPending] = useActionState(
    isRegister ? confirmRegisterAction : confirmLoginAction,
    initialAuthActionState
  );

  const phone = confirmState.phone || requestState.phone || passwordState.phone || "";
  const name = confirmState.name || requestState.name || passwordState.name || "";
  const codeMessage = confirmState.message || requestState.message;
  const codeStatus = confirmState.status !== "idle" ? confirmState.status : requestState.status;
  const shouldShowConfirmCode = requestState.status === "code_sent" || confirmState.status !== "idle";

  return (
    <section className="rounded-lg border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.10)] sm:p-8">
      <h1 className="text-3xl font-black leading-tight text-karimoff-black">
        {isRegister ? "Регистрация" : "Вход"}
      </h1>
      <p className="mt-4 text-sm leading-6 text-karimoff-muted">
        {isRegister
          ? "Создайте профиль, чтобы быстро оформлять заказы и копить баллы."
          : codeMode
            ? "Получите одноразовый код по SMS и войдите без пароля."
            : "Войдите по телефону и постоянному паролю."}
      </p>

      <SocialAuthButtons enabled={socialProviders} returnTo={redirectTo || (next === "checkout" ? "/checkout" : "/profile")} />
      {socialError ? <p className="mt-4 text-sm font-semibold text-red-600">{socialError}</p> : null}

      {!codeMode ? (
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
          className="rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.22)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65"
        >
          {isPasswordPending ? "Проверяем" : isRegister ? "Зарегистрироваться" : "Войти"}
        </button>
      </form>

      ) : null}

      {!codeMode && passwordState.message ? (
        <p className={passwordState.status === "error" ? "mt-5 text-sm font-semibold text-red-600" : "mt-5 text-sm font-semibold text-karimoff-orange"}>
          {passwordState.message}
        </p>
      ) : null}

      <div className={`${codeMode ? "mt-7" : "mt-6"} rounded-lg border border-karimoff-line bg-karimoff-soft/70 p-4`}>
        <button
          type="button"
          onClick={() => setCodeMode((value) => !value)}
          className="text-sm font-bold text-karimoff-orange transition hover:text-[#D95405]"
        >
          {codeMode
            ? isRegister
              ? "Создать профиль с паролем"
              : "Войти по паролю"
            : isRegister
              ? "Зарегистрироваться по коду из SMS"
              : "Войти по коду из SMS"}
        </button>

        {codeMode ? (
          <div className="mt-4 grid gap-4">
            <form action={requestAction} className="grid gap-4">
              {isRegister ? (
                <>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-karimoff-muted">Имя</span>
                    <input
                      name="name"
                      required
                      defaultValue={name}
                      className="h-[48px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition focus:border-karimoff-orange"
                      placeholder="Ваше имя"
                    />
                  </label>
                  <div className="grid gap-3 text-sm">
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
                        Согласие на{" "}
                        <Link href="/legal/personal-data-consent" target="_blank" className="font-bold text-karimoff-orange">
                          обработку персональных данных
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
                        Участвовать в{" "}
                        <Link href="/legal/loyalty" target="_blank" className="font-bold text-karimoff-orange">
                          KARIMOFF Bonus
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
                        Получать акции и предложения
                      </span>
                    </label>
                  </div>
                </>
              ) : null}
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-karimoff-muted">Телефон</span>
                <PhoneInput
                  name="phone"
                  required
                  defaultValue={phone}
                  className="h-[48px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition focus:border-karimoff-orange"
                />
              </label>
              <button
                type="submit"
                disabled={isRequestPending}
                className="rounded-full border border-karimoff-orange bg-white px-5 py-3 text-sm font-bold text-karimoff-orange transition hover:bg-karimoff-orange hover:text-white disabled:opacity-60"
              >
                {isRequestPending ? "Отправляем код" : "Получить код по SMS"}
              </button>
            </form>

            {shouldShowConfirmCode ? (
              <form action={confirmAction} className="grid gap-4 border-t border-karimoff-line pt-4">
                {isRegister ? <input type="hidden" name="name" value={name} /> : null}
                {isRegister ? (
                  <>
                    <input type="hidden" name="personal_data_consent" value={personalDataConsent ? "on" : ""} />
                    <input type="hidden" name="marketing_consent" value={marketingConsent ? "on" : ""} />
                    <input type="hidden" name="loyalty_consent" value={loyaltyConsent ? "on" : ""} />
                  </>
                ) : null}
                <input type="hidden" name="phone" value={phone} />
                <input type="hidden" name="next" value={next ?? ""} />
                <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-karimoff-muted">Код подтверждения</span>
                  <input
                    name="code"
                    required
                    inputMode="numeric"
                    className="h-[48px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition focus:border-karimoff-orange"
                    placeholder="6 цифр"
                  />
                </label>
                <button
                  type="submit"
                  disabled={isConfirmPending}
                  className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white transition hover:bg-[#D95405] disabled:opacity-60"
                >
                  {isConfirmPending ? "Проверяем" : isRegister ? "Зарегистрироваться по коду" : "Войти по коду"}
                </button>
              </form>
            ) : null}

            {codeMessage ? (
              <p className={codeStatus === "error" ? "text-sm font-semibold text-red-600" : "text-sm font-semibold text-karimoff-orange"}>
                {codeMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-6 text-sm text-karimoff-muted">
        {isRegister ? (
          <>
            Уже есть профиль?{" "}
            <Link href={`/login${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : next ? `?next=${next}` : ""}`} className="font-bold text-karimoff-orange">
              Войти
            </Link>
          </>
        ) : (
          <>
            Нет профиля?{" "}
            <Link href={`/register${redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : next ? `?next=${next}` : ""}`} className="font-bold text-karimoff-orange">
              Зарегистрироваться
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
