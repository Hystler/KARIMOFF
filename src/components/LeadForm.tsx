"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { createLeadAction } from "@/app/actions/leads";
import { initialLeadActionState, type LeadFormInput } from "@/lib/lead-schema";
import { formatRussianPhoneInput } from "@/lib/phone";

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
  const [selectedInterest, setSelectedInterest] = useState(defaultInterest);

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
        setSelectedInterest(detail.interest);
      }

      if (typeof detail?.comment === "string" && commentRef.current) {
        commentRef.current.value = detail.comment;
      }
    }

    window.addEventListener("karimoff-lead-prefill", handlePrefill);
    return () => window.removeEventListener("karimoff-lead-prefill", handlePrefill);
  }, []);

  return (
    <section id="lead" className="container-page scroll-mt-28 py-12 sm:py-16">
      <div className="grid grid-cols-1 gap-7 rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:p-7 lg:grid-cols-[0.72fr_1fr] lg:gap-10 lg:p-9">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-karimoff-orange">Заявка</p>
          <h2 className="mt-3 text-balance text-3xl font-black leading-[1.12] text-karimoff-black sm:text-4xl">
            Связаться с KARIMOFF
          </h2>
          <p className="mt-4 max-w-md text-base leading-7 text-karimoff-muted">
            Оставьте контакт, и мы вернёмся с ответом по сотрудничеству,
            работе или франшизе.
          </p>
        </div>

        <form
          ref={formRef}
          action={formAction}
          className="grid min-w-0 grid-cols-1 gap-4 border-t border-karimoff-line pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0"
        >
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Имя</span>
            <input
              name="name"
              required
              placeholder="Ваше имя"
              className="h-[50px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
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
              onBlur={(event) => {
                event.currentTarget.value = formatRussianPhoneInput(event.currentTarget.value);
              }}
              className="h-[50px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Интерес</span>
            <select
              ref={interestRef}
              name="interest"
              className="h-[50px] rounded-lg border border-karimoff-line bg-white px-4 text-karimoff-black outline-none transition focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
              defaultValue={defaultInterest}
              onChange={(event) => setSelectedInterest(event.target.value as LeadFormInput["interest"])}
            >
              {interests.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 rounded-lg border border-karimoff-line bg-karimoff-cream/70 p-4 text-sm">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="personal_data_consent"
                required
                className="mt-0.5 h-5 w-5 shrink-0 accent-karimoff-orange"
              />
              <span className="leading-6 text-karimoff-muted">
                Я даю согласие на обработку персональных данных для{" "}
                {selectedInterest === "career"
                  ? "рассмотрения отклика на вакансию"
                  : selectedInterest === "franchise"
                    ? "рассмотрения заявки на франшизу"
                    : "рассмотрения обращения"}
                .{" "}
                <Link
                  href={
                    selectedInterest === "career"
                      ? "/legal/careers-consent"
                      : selectedInterest === "franchise"
                        ? "/legal/franchise-consent"
                        : "/legal/personal-data-consent"
                  }
                  target="_blank"
                  className="font-bold text-karimoff-orange"
                >
                  Текст согласия
                </Link>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="marketing_consent"
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
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-karimoff-muted">Комментарий</span>
            <textarea
              ref={commentRef}
              name="comment"
              rows={4}
              defaultValue={defaultComment}
              placeholder="Расскажите, что нужно подготовить"
              className="resize-none rounded-lg border border-karimoff-line bg-white px-4 py-3 text-karimoff-black outline-none transition placeholder:text-karimoff-muted/55 focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]"
            />
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="mt-1 min-h-12 rounded-full border border-karimoff-orange bg-karimoff-orange px-7 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
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
