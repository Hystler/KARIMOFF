import Link from "next/link";

export function BusinessSection() {
  return (
    <section className="py-16 sm:py-24">
      <div className="container-page">
        <div className="rounded-lg border border-karimoff-line bg-[linear-gradient(135deg,rgba(251,103,10,0.13),#FFFFFF_42%,#F8F4EE)] p-6 sm:p-10 lg:p-12">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <h2 className="text-balance text-4xl font-black leading-none text-karimoff-black sm:text-6xl">
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
                className="mt-7 inline-flex rounded-full bg-karimoff-orange px-6 py-3 text-sm font-bold text-white transition hover:bg-karimoff-black"
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
