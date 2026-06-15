"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  confirmLoginAction,
  confirmRegisterAction,
  requestLoginCodeAction,
  requestRegisterCodeAction
} from "@/app/auth/actions";
import { initialAuthActionState } from "@/lib/customer-schema";

type AuthFormProps = {
  mode: "login" | "register";
  next?: string;
};

export function AuthForm({ mode, next }: AuthFormProps) {
  const isRegister = mode === "register";
  const [requestState, requestAction, isRequestPending] = useActionState(
    isRegister ? requestRegisterCodeAction : requestLoginCodeAction,
    initialAuthActionState
  );
  const [confirmState, confirmAction, isConfirmPending] = useActionState(
    isRegister ? confirmRegisterAction : confirmLoginAction,
    initialAuthActionState
  );

  const phone = confirmState.phone || requestState.phone || "";
  const name = confirmState.name || requestState.name || "";
  const message = confirmState.message || requestState.message;
  const status = confirmState.status !== "idle" ? confirmState.status : requestState.status;

  return (
    <section className="rounded-lg border border-karimoff-line bg-white p-6 shadow-card sm:p-8">
      <h1 className="text-4xl font-black leading-none text-karimoff-black">
        {isRegister ? "Регистрация" : "Вход"}
      </h1>
      <p className="mt-4 text-sm leading-6 text-karimoff-muted">
        {isRegister
          ? "Создайте профиль, чтобы оформлять заказ без повторного ввода имени и телефона."
          : "Войдите по телефону, чтобы продолжить оформление заказа."}
      </p>

      <form action={requestAction} className="mt-7 grid gap-4">
        {isRegister ? (
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Имя</span>
            <input
              name="name"
              required
              defaultValue={name}
              className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange"
              placeholder="Ваше имя"
            />
          </label>
        ) : null}
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-karimoff-muted">Телефон</span>
          <input
            name="phone"
            required
            inputMode="tel"
            defaultValue={phone}
            className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange"
            placeholder="+7"
          />
        </label>
        <button
          type="submit"
          disabled={isRequestPending}
          className="rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65"
        >
          {isRequestPending ? "Отправляем код" : "Получить код"}
        </button>
      </form>

      {requestState.status === "code_sent" || phone ? (
        <form action={confirmAction} className="mt-6 grid gap-4 border-t border-karimoff-line pt-6">
          {isRegister ? <input type="hidden" name="name" value={name} /> : null}
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="next" value={next ?? ""} />
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Код подтверждения</span>
            <input
              name="code"
              required
              inputMode="numeric"
              className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange"
              placeholder="6 цифр"
            />
          </label>
          <button
            type="submit"
            disabled={isConfirmPending}
            className="rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65"
          >
            {isConfirmPending ? "Проверяем" : isRegister ? "Зарегистрироваться" : "Войти"}
          </button>
        </form>
      ) : null}

      {message ? (
        <p className={status === "error" ? "mt-5 text-sm font-semibold text-red-600" : "mt-5 text-sm font-semibold text-karimoff-orange"}>
          {message}
        </p>
      ) : null}

      <div className="mt-6 text-sm text-karimoff-muted">
        {isRegister ? (
          <>
            Уже есть профиль?{" "}
            <Link href={`/login${next ? `?next=${next}` : ""}`} className="font-bold text-karimoff-orange">
              Войти
            </Link>
          </>
        ) : (
          <>
            Нет профиля?{" "}
            <Link href={`/register${next ? `?next=${next}` : ""}`} className="font-bold text-karimoff-orange">
              Зарегистрироваться
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
