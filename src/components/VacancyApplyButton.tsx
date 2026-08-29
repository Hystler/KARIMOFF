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
      className="public-button-primary mt-auto px-5"
    >
      Откликнуться
    </button>
  );
}
