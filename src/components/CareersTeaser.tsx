import Link from "next/link";

export function CareersTeaser() {
  return (
    <section className="container-page pb-16 sm:pb-24">
      <div className="matte-card grid gap-8 rounded-lg p-6 sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <h2 className="text-balance text-4xl font-black leading-none text-karimoff-black sm:text-6xl">
          Работайте в KARIMOFF
        </h2>
        <div>
          <p className="text-lg leading-8 text-karimoff-muted">
            Ищем людей в команду кухни, сервиса и управления. Обучаем процессам,
            стандартам и продукту.
          </p>
          <Link
            href="/careers"
            className="mt-7 inline-flex rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
          >
            Смотреть вакансии
          </Link>
        </div>
      </div>
    </section>
  );
}
