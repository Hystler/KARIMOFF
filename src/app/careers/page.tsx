import Link from "next/link";
import { LeadForm } from "@/components/LeadForm";

const offers = [
  "Оплату от 450 рублей в час на стартовом этапе.",
  "Стабильные и своевременные выплаты.",
  "Обучение всем рабочим процессам.",
  "Поддержку со стороны команды и руководства.",
  "Возможность подобрать удобный график работы.",
  "Комфортную рабочую атмосферу без лишней бюрократии.",
  "Возможность карьерного роста внутри компании."
];

export default function CareersPage() {
  return (
    <main className="bg-karimoff-cream pt-24 text-karimoff-black">
      <section className="container-page pb-14 pt-8 sm:pb-20 sm:pt-12">
        <div className="rounded-[1.75rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-10">
          <p className="text-sm font-semibold text-karimoff-orange">Работа в KARIMOFF</p>
          <div className="mt-4 grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <h1 className="text-balance text-4xl font-black leading-[0.96] sm:text-6xl">
              Работа, где важен результат каждого человека
            </h1>
            <p className="max-w-xl text-base leading-7 text-karimoff-muted sm:text-lg">
              Мы ищем людей, которые готовы соблюдать стандарты, учиться,
              работать в команде и уважительно относиться к гостям.
            </p>
          </div>
          <Link
            href="#lead"
            className="mt-8 inline-flex rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.20)] transition hover:-translate-y-0.5 hover:bg-[#D95405]"
          >
            Заполнить анкету
          </Link>
        </div>
      </section>

      <section className="container-page pb-14 sm:pb-20">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">Команда</p>
            <h2 className="mt-3 text-balance text-3xl font-black leading-tight sm:text-5xl">
              Хорошая бургерная начинается с людей
            </h2>
          </div>
          <div className="grid gap-5 text-base leading-8 text-karimoff-muted">
            <p>
              Хорошая бургерная начинается не с оборудования и не с рецептов.
              Она начинается с людей.
            </p>
            <p>
              Поэтому мы ищем сотрудников, которые готовы ответственно относиться
              к своей работе, соблюдать стандарты и уважительно относиться к
              гостям и коллегам.
            </p>
            <p>
              Опыт работы будет преимуществом, но для нас гораздо важнее желание
              учиться и развиваться. Мы поможем освоить процессы, познакомим со
              стандартами и поддержим на этапе адаптации.
            </p>
            <p>
              Мы понимаем, что у каждого своя жизненная ситуация. Кто-то совмещает
              работу с учебой, кто-то ищет гибкий график, а кто-то хочет полностью
              посвятить себя профессии. Поэтому мы стараемся находить решения и
              по возможности подбирать удобный формат работы для каждого сотрудника.
            </p>
          </div>
        </div>
      </section>

      <section className="container-page pb-14 sm:pb-20">
        <div className="rounded-[1.75rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-10">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold text-karimoff-orange">Что мы предлагаем</p>
            <h2 className="mt-3 text-balance text-3xl font-black leading-tight sm:text-5xl">
              Понятные условия и поддержка команды
            </h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {offers.map((offer) => (
              <div key={offer} className="flex gap-3 rounded-xl border border-karimoff-line bg-karimoff-cream p-4">
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-karimoff-orange" />
                <p className="text-sm leading-6 text-karimoff-muted">{offer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container-page pb-14 sm:pb-20">
        <div className="grid gap-8 rounded-[1.75rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">Рост внутри компании</p>
            <h2 className="mt-3 text-balance text-3xl font-black leading-tight sm:text-5xl">
              Развитие через ответственность и стандарты
            </h2>
          </div>
          <div className="grid gap-5 text-base leading-8 text-karimoff-muted">
            <p>Мы не рассматриваем сотрудников как временный персонал.</p>
            <p>
              Если человек показывает ответственность, соблюдает стандарты и
              помогает команде становиться сильнее, он получает возможности для
              дальнейшего развития.
            </p>
            <p>
              Вместе с опытом растет уровень ответственности, должность и уровень
              дохода.
            </p>
            <p>
              Для нас важно формировать команду из людей, которые хотят
              развиваться вместе с брендом, а не просто отработать смену и уйти
              домой.
            </p>
            <p>Мы ценим людей, которые добросовестно делают свою работу.</p>
          </div>
        </div>
      </section>

      <section className="container-page pb-8">
        <div className="rounded-[1.75rem] bg-karimoff-black p-6 text-white shadow-[0_24px_70px_rgba(18,18,20,0.16)] sm:p-10">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <p className="max-w-3xl text-balance text-3xl font-black leading-tight sm:text-5xl">
              Если вам близки порядок, дисциплина, уважение к гостям и желание
              развиваться в сильной команде — будем рады познакомиться.
            </p>
            <Link
              href="#lead"
              className="inline-flex rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.22)] transition hover:-translate-y-0.5 hover:bg-[#D95405]"
            >
              Заполнить анкету
            </Link>
          </div>
        </div>
      </section>

      <LeadForm defaultInterest="career" />
    </main>
  );
}
