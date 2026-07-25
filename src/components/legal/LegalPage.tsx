import type { LegalDocument } from "@/lib/legal-content";

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <main className="bg-karimoff-cream pb-16 pt-28 text-karimoff-black sm:pb-24 sm:pt-32">
      <header className="container-page">
        <div className="max-w-[820px] border-b border-karimoff-line pb-9">
          <p className="text-sm font-bold text-karimoff-orange">KARIMOFF · юридическая информация</p>
          <h1 className="mt-4 text-balance text-3xl font-black leading-[1.1] sm:text-5xl sm:leading-[1.05]">
            {document.title}
          </h1>
          <p className="mt-5 max-w-[720px] text-base leading-7 text-karimoff-muted sm:text-lg sm:leading-8">
            {document.subtitle}
          </p>
          <p className="mt-5 text-xs font-semibold text-karimoff-muted">Версия: {document.version}</p>
        </div>
      </header>

      <div className="container-page mt-10 grid max-w-[1040px] gap-6">
        {document.sections.map((section) => (
          <section
            key={section.title}
            className="rounded-lg border border-karimoff-line bg-white p-5 shadow-[0_16px_48px_rgba(18,18,20,0.05)] sm:p-8"
          >
            <h2 className="text-xl font-black leading-[1.2] sm:text-2xl">{section.title}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-4 max-w-[780px] text-[15px] leading-7 text-karimoff-muted sm:text-base">
                {paragraph}
              </p>
            ))}
            {section.bullets?.length ? (
              <ul className="mt-5 grid max-w-[800px] gap-3">
                {section.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-3 text-[15px] leading-7 text-karimoff-muted sm:text-base">
                    <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-karimoff-orange" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {section.facts?.length ? (
              <dl className="mt-6 grid overflow-hidden rounded-lg border border-karimoff-line">
                {section.facts.map((fact) => (
                  <div key={fact.label} className="grid gap-1 border-b border-karimoff-line p-4 last:border-b-0 sm:grid-cols-[190px_1fr] sm:gap-5">
                    <dt className="text-sm font-bold text-karimoff-black">{fact.label}</dt>
                    <dd className="min-w-0 break-words text-sm leading-6 text-karimoff-muted">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>
        ))}
      </div>
    </main>
  );
}
