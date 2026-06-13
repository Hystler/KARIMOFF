import { LeadForm } from "@/components/LeadForm";

const roles = ["Кухня", "Сервис", "Управление"];

export default function CareersPage() {
  return (
    <main className="pt-28">
      <section className="container-page pb-16">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold text-karimoff-orange">
            Работа в KARIMOFF
          </p>
          <h1 className="text-balance text-4xl font-black leading-[0.95] text-karimoff-black sm:text-6xl">
            Команда для кухни, сервиса и управления
          </h1>
          <p className="mt-6 text-base leading-7 text-karimoff-muted sm:text-lg">
            Ищем людей, которым близки чистые процессы, быстрый темп и уважение к продукту.
            Обучаем стандартам, кухне и сервису внутри бренда.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {roles.map((role) => (
            <article key={role} className="matte-card rounded-lg p-6">
              <h2 className="text-2xl font-black text-karimoff-black">{role}</h2>
              <p className="mt-3 text-sm leading-6 text-karimoff-muted">
                Оставьте контакты, и мы подготовим подходящий сценарий собеседования после
                запуска раздела вакансий.
              </p>
            </article>
          ))}
        </div>
      </section>
      <LeadForm />
    </main>
  );
}
