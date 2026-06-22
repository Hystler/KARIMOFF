import Link from "next/link";

export function BusinessSection() {
  return (
    <section className="py-14 sm:py-24">
      <div className="container-page">
        <div className="business-card relative overflow-hidden rounded-lg border border-karimoff-line bg-[linear-gradient(135deg,rgba(251,103,10,0.14),#FFFFFF_42%,#F8F4EE)] p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-10 lg:p-12">
          <div className="relative z-10 grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <h2 className="text-balance text-4xl font-black leading-[0.98] text-karimoff-black sm:text-6xl">
              KARIMOFF для бизнеса
            </h2>
            <div>
              <p className="text-lg leading-8 text-karimoff-muted">
                Готовим форматы для корпоративных заказов, мероприятий, pop-up точек
                и партнёрских проектов. Подберём решение под площадку, поток гостей
                и задачу.
              </p>
              <Link
                href="#lead"
                className="mt-7 inline-flex rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
              >
                Обсудить сотрудничество
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
