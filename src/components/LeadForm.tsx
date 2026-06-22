"use client";

import { useActionState, useEffect, useRef } from "react";
import { createLeadAction } from "@/app/actions/leads";
import { initialLeadActionState, type LeadFormInput } from "@/lib/lead-schema";

const interests = [
  { value: "b2b", label: "B2B" },
  { value: "career", label: "Работа" },
  { value: "franchise", label: "Франшиза" },
  { value: "other", label: "Другое" }
] as const;

type LeadFormProps = {
  defaultComment?: string;
  defaultInterest?: LeadFormInput["interest"];
};

type LeadPrefillDetail = {
  comment?: string;
  interest?: LeadFormInput["interest"];
};

export function LeadForm({ defaultComment = "", defaultInterest = "b2b" }: LeadFormProps) {
  const [state, formAction, isPending] = useActionState(createLeadAction, initialLeadActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const interestRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  useEffect(() => {
    function handlePrefill(event: Event) {
      const detail = (event as CustomEvent<LeadPrefillDetail>).detail;

      if (detail?.interest && interestRef.current) {
        interestRef.current.value = detail.interest;
      }

      if (typeof detail?.comment === "string" && commentRef.current) {
        commentRef.current.value = detail.comment;
      }
    }

    window.addEventListener("karimoff-lead-prefill", handlePrefill);
    return () => window.removeEventListener("karimoff-lead-prefill", handlePrefill);
  }, []);

  return (
    <section id="lead" className="container-page scroll-mt-28 py-14 sm:py-20">
      <div className="grid grid-cols-1 gap-8 rounded-[1.5rem] border border-karimoff-line bg-white p-5 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-8 lg:grid-cols-[0.78fr_1fr] lg:p-10">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-karimoff-orange">Заявка</p>
          <h2 className="mt-3 text-balance text-3xl font-black leading-tight text-karimoff-black sm:text-5xl">
            Связаться с KARIMOFF
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-karimoff-muted">
            Оставьте контакт, и мы вернёмся с ответом по сотрудничеству,
            работе или франшизе.
          </p>
        </div>

        <form ref={formRef} action={formAction} className="grid min-w-0 grid-cols-1 gap-4 rounded-[1.25rem] border border-karimoff-line bg-karimoff-cream/70 p-4 sm:p-5">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Имя</span>
            <input
              name="name"
              required
              placeholder="Ваше имя"
              className="h-[50px] rounded-xl border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
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
              className="h-[50px] rounded-xl border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Интерес</span>
            <select
              ref={interestRef}
              name="interest"
              className="h-[50px] rounded-xl border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
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
              defaultValue={defaultComment}
              placeholder="Расскажите, что нужно подготовить"
              className="resize-none rounded-xl border border-karimoff-line bg-white px-4 py-3 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
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
