import Link from "next/link";

export function FranchiseTeaser() {
  return (
    <section className="container-page py-16 sm:py-20">
      <div className="grid gap-8 border-t border-karimoff-line pt-12 lg:grid-cols-[1fr_0.85fr] lg:items-end">
        <div>
          <p className="text-sm font-semibold text-karimoff-orange">Франшиза</p>
          <h2 className="mt-3 text-balance text-4xl font-black leading-none text-karimoff-black sm:text-6xl">
            Откройте KARIMOFF в своём городе
          </h2>
        </div>
        <div>
          <p className="text-lg leading-8 text-karimoff-muted">
            Франшиза KARIMOFF — это бренд, меню, операционные стандарты, обучение
            и поддержка запуска. Финансовый блок заполняется на основе выбранного
            формата точки.
          </p>
          <Link
            href="/franchise"
            className="mt-7 inline-flex rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
          >
            Смотреть франшизу
          </Link>
        </div>
      </div>
    </section>
  );
}
