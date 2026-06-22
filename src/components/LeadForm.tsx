"use client";

import { useActionState, useEffect, useRef } from "react";
import { createLeadAction } from "@/app/actions/leads";
import { initialLeadActionState, type LeadFormInput } from "@/lib/lead-schema";
import { CHECKOUT_COMMENT_KEY } from "./cart/CartProvider";

const interests = [
  { value: "b2b", label: "B2B" },
  { value: "career", label: "Работа" },
  { value: "franchise", label: "Франшиза" },
  { value: "other", label: "Другое" }
] as const;

type LeadFormProps = {
  defaultInterest?: LeadFormInput["interest"];
};

export function LeadForm({ defaultInterest = "b2b" }: LeadFormProps) {
  const [state, formAction, isPending] = useActionState(createLeadAction, initialLeadActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      window.localStorage.removeItem(CHECKOUT_COMMENT_KEY);
      window.dispatchEvent(new Event("karimoff-lead-success"));
    }
  }, [state.status]);

  useEffect(() => {
    function applyCheckoutComment(comment: string | null) {
      if (comment && commentRef.current) {
        commentRef.current.value = comment;
      }
    }

    applyCheckoutComment(window.localStorage.getItem(CHECKOUT_COMMENT_KEY));

    function handleCheckout(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      applyCheckoutComment(detail);
    }

    window.addEventListener("karimoff-cart-checkout", handleCheckout);
    return () => window.removeEventListener("karimoff-cart-checkout", handleCheckout);
  }, []);

  return (
    <section id="lead" className="container-page py-16 sm:py-24">
      <div className="grid gap-8 rounded-lg border border-karimoff-line bg-karimoff-cream p-6 shadow-card sm:p-10 lg:grid-cols-[0.85fr_1.15fr] lg:p-12">
        <div>
          <p className="text-sm font-semibold text-karimoff-orange">Заявка</p>
          <h2 className="mt-3 text-balance text-4xl font-black leading-none text-karimoff-black sm:text-6xl">
            Связаться с KARIMOFF
          </h2>
          <p className="mt-6 text-base leading-7 text-karimoff-muted">
            Оставьте контакт, и мы вернёмся с ответом по сотрудничеству,
            работе или франшизе.
          </p>
        </div>

        <form ref={formRef} action={formAction} className="grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Имя</span>
            <input
              name="name"
              required
              placeholder="Ваше имя"
              className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Телефон</span>
            <input
              name="phone"
              required
              inputMode="tel"
              defaultValue="+7"
              placeholder="+7"
              className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Интерес</span>
            <select
              name="interest"
              className="h-[52px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition focus:border-karimoff-orange"
              defaultValue={defaultInterest}
            >
              {interests.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Комментарий</span>
            <textarea
              ref={commentRef}
              name="comment"
              rows={5}
              placeholder="Расскажите, что нужно подготовить"
              className="resize-none rounded-lg border border-karimoff-line bg-white px-4 py-3 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange"
            />
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="mt-2 rounded-full border border-karimoff-orange bg-karimoff-orange px-7 py-4 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending ? "Отправляем" : "Отправить заявку"}
          </button>
          {state.status !== "idle" ? (
            <p className={state.status === "success" ? "text-sm font-semibold text-karimoff-orange" : "text-sm font-semibold text-red-600"}>
              {state.message}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}
