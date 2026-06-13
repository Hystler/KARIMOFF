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
            className="mt-7 inline-flex rounded-full bg-karimoff-black px-6 py-3 text-sm font-bold text-white transition hover:bg-karimoff-orange"
          >
            Смотреть вакансии
          </Link>
        </div>
      </div>
    </section>
  );
}
