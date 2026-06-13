import Link from "next/link";
import { LeadForm } from "@/components/LeadForm";
import { franchiseFormats, franchiseHighlights } from "@/data/franchise";

export default function FranchisePage() {
  return (
    <main className="pt-28">
      <section className="container-page pb-16">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div>
            <p className="mb-4 text-sm font-semibold text-karimoff-orange">
              Франшиза
            </p>
            <h1 className="text-balance text-4xl font-black leading-[0.95] text-karimoff-black sm:text-6xl">
              Откройте KARIMOFF в своём городе
            </h1>
          </div>
          <p className="text-base leading-7 text-karimoff-muted sm:text-lg">
            Франшиза KARIMOFF — это бренд, меню, операционные стандарты, обучение
            и поддержка запуска. Финансовый блок заполняется на основе выбранного
            формата точки.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {franchiseHighlights.map((item) => (
            <article key={item.title} className="matte-card rounded-lg p-6">
              <h2 className="text-xl font-black text-karimoff-black">{item.title}</h2>
              <p className="mt-3 text-sm leading-6 text-karimoff-muted">{item.description}</p>
            </article>
          ))}
        </div>

        <div className="mt-12 rounded-lg border border-karimoff-line bg-karimoff-cream p-6 sm:p-8">
          <h2 className="text-3xl font-black text-karimoff-black">Форматы запуска</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {franchiseFormats.map((item) => (
              <div key={item.title} className="border-t border-karimoff-line pt-4">
                <h3 className="font-black text-karimoff-black">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-karimoff-muted">{item.description}</p>
              </div>
            ))}
          </div>
          <Link
            href="#lead"
            className="mt-8 inline-flex rounded-full bg-karimoff-orange px-6 py-3 text-sm font-bold text-white transition hover:bg-karimoff-black"
          >
            Оставить заявку
          </Link>
        </div>
      </section>
      <LeadForm />
    </main>
  );
}
