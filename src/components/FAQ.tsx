import { faqItems } from "@/data/faq";

export function FAQ() {
  return (
    <section className="border-y border-karimoff-line bg-karimoff-cream py-16 sm:py-24">
      <div className="container-page grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="text-sm font-semibold text-karimoff-orange">FAQ</p>
          <h2 className="mt-3 text-balance text-4xl font-black text-karimoff-black sm:text-5xl">
            Частые вопросы
          </h2>
        </div>
        <div className="space-y-3">
          {faqItems.map((item) => (
            <details key={item.question} className="group rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-lg font-black text-karimoff-black">
                {item.question}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-karimoff-line text-karimoff-orange transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-4 text-sm leading-6 text-karimoff-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
