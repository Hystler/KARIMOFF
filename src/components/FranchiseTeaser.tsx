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
            className="mt-7 inline-flex rounded-full border border-karimoff-black/25 px-6 py-3 text-sm font-bold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
          >
            Смотреть франшизу
          </Link>
        </div>
      </div>
    </section>
  );
}
