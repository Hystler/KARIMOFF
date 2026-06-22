"use client";

type VacancyApplyButtonProps = {
  title: string;
};

export function VacancyApplyButton({ title }: VacancyApplyButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent("karimoff-lead-prefill", {
            detail: {
              comment: `Хочу откликнуться на вакансию: ${title}`,
              interest: "career"
            }
          })
        );
        document.getElementById("lead")?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.replaceState(null, "", "#lead");
      }}
      className="mt-auto rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-center text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
    >
      Откликнуться
    </button>
  );
}
