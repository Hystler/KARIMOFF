import Link from "next/link";
import type { ReactNode } from "react";
import { LeadForm } from "@/components/LeadForm";
import { PageHero } from "@/components/PageHero";
import { getSiteSettings } from "@/lib/settings";

const partnerGets = [
  { title: "Бизнес-модель", text: "готовую бизнес-модель" },
  { title: "Рецептуры", text: "проверенные рецептуры и технологические карты" },
  { title: "Стандарты", text: "стандарты работы кухни и сервиса" },
  { title: "Обучение", text: "обучение команды" },
  { title: "Маркетинг", text: "маркетинговую поддержку" },
  { title: "Запуск", text: "помощь при запуске точки" },
  { title: "Сопровождение", text: "сопровождение после открытия" }
];

const partnerFit = [
  "готовы лично участвовать в развитии бизнеса",
  "уважают стандарты и понимают их ценность",
  "умеют работать с командой",
  "любят сферу общественного питания или хотят глубоко в нее погрузиться",
  "готовы ежедневно работать над качеством продукта и сервиса"
];

function TextBlock({
  eyebrow,
  title,
  children
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="container-page pb-12 sm:pb-16">
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[0.72fr_1fr]">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-karimoff-orange">{eyebrow}</p>
          <h2 className="mt-3 max-w-xl text-balance text-3xl font-black leading-tight sm:text-4xl">{title}</h2>
        </div>
        <div className="grid min-w-0 max-w-[760px] grid-cols-1 gap-5 text-[17px] leading-8 text-karimoff-muted sm:text-lg">{children}</div>
      </div>
    </section>
  );
}

export default async function FranchisePage() {
  const settings = await getSiteSettings();

  return (
    <main className="bg-karimoff-cream text-karimoff-black">
      <PageHero
        eyebrow="Франшиза"
        title="Мы ищем единомышленников, а не инвесторов"
        subtitle="KARIMOFF подходит тем, кто хочет лично участвовать в развитии бизнеса, соблюдать стандарты и строить сильную команду."
        ctaHref="#lead"
        ctaLabel="Оставить заявку на знакомство"
        imageUrl={settings.franchise_hero_image_url}
        objectPosition="center"
      />

      <section className="container-page py-12 sm:py-16">
        <div className="rounded-[1.75rem] bg-karimoff-black p-6 text-white shadow-[0_24px_70px_rgba(18,18,20,0.16)] sm:p-9">
          <div className="mb-5 h-1.5 w-14 rounded-full bg-karimoff-orange" />
          <p className="max-w-4xl text-balance text-2xl font-black leading-tight sm:text-4xl">
            Настоящий ресторанный бизнес строится не на красивых презентациях.
            Он строится на внимании к деталям каждый день.
          </p>
        </div>
      </section>

      <TextBlock eyebrow="Партнёрство" title="Мы ищем единомышленников, а не инвесторов">
        <p>Можно купить оборудование. Можно арендовать помещение. Можно повесить вывеску.</p>
        <p>
          Но невозможно построить сильную сеть, если партнеру безразлично то,
          что происходит внутри его собственного бизнеса.
        </p>
        <p>
          Поэтому мы НЕ ищем людей, которые хотят вложить деньги и просто ждать
          выручку.
        </p>
        <p>Мы ищем тех, кто действительно хочет заниматься своим делом.</p>
        <p>
          Тех, кто готов приезжать в свою точку утром, разговаривать с
          сотрудниками, готовить с ними плечом к плечу, если большая нагрузка,
          следить за качеством продукта и понимать, почему гость возвращается
          снова.
        </p>
      </TextBlock>

      <TextBlock eyebrow="Стандарты" title="Мы верим в стандарты">
        <p>
          Гость приходит к нам не за сюрпризами. Он приходит за вкусом, который
          ему уже понравился. Поэтому в основе KARIMOFF лежит единая система
          работы.
        </p>
        <p>
          Рецептуры, процессы приготовления, стандарты сервиса и требования к
          качеству должны соблюдаться одинаково в каждой точке сети.
        </p>
        <p>
          Мы убеждены, что именно дисциплина позволяет создавать продукт,
          которому доверяют люди.
        </p>
      </TextBlock>

      <TextBlock eyebrow="Прозрачность" title="Мы строим открытый бизнес">
        <p>
          Мы считаем, что партнерство начинается с доверия. Поэтому стараемся
          делать процессы максимально прозрачными.
        </p>
        <p>
          Мы открыто говорим о требованиях, ожиданиях и стандартах работы. Не
          обещаем легких денег и мгновенного успеха.
        </p>
        <p>
          Зато готовы честно делиться опытом, помогать в развитии и вместе
          решать возникающие задачи.
        </p>
      </TextBlock>

      <section className="container-page pb-12 sm:pb-16">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <article className="min-w-0 rounded-[1.75rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-8">
            <p className="text-sm font-semibold text-karimoff-orange">Что получает партнер</p>
            <h2 className="mt-3 max-w-xl text-3xl font-black leading-tight sm:text-4xl">
              Не просто имя бренда, а систему управления
            </h2>
            <p className="mt-5 max-w-[680px] text-base leading-7 text-karimoff-muted sm:text-lg sm:leading-8">
              Мы передаем не просто имя бренда. Мы передаем систему, которая
              помогает ежедневно управлять бизнесом.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {partnerGets.map((item) => (
                <div key={item.title} className="rounded-xl border border-karimoff-line bg-karimoff-cream p-4">
                  <h3 className="text-sm font-black text-karimoff-black">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-karimoff-muted">{item.text}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-base leading-7 text-karimoff-muted sm:text-lg sm:leading-8">
              Наша задача — не продать франшизу и исчезнуть.
            </p>
            <p className="mt-3 text-base leading-7 text-karimoff-muted sm:text-lg sm:leading-8">
              Наша задача — помочь партнеру построить сильный и устойчивый
              бизнес.
            </p>
          </article>

          <article className="min-w-0 rounded-[1.75rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-8">
            <p className="text-sm font-semibold text-karimoff-orange">Кому подойдет KARIMOFF</p>
            <h2 className="mt-3 max-w-xl text-3xl font-black leading-tight sm:text-4xl">
              Предпринимателям, которые готовы быть внутри дела
            </h2>
            <ul className="mt-6 grid grid-cols-1 gap-3">
              {partnerFit.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-6 text-karimoff-muted">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-karimoff-orange" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 grid grid-cols-1 gap-4 text-base leading-7 text-karimoff-muted sm:text-lg sm:leading-8">
              <p>Если вы ищете пассивную инвестицию, вероятно, мы вам не подходим.</p>
              <p>
                Если вы хотите построить сильный бизнес своими руками и стать
                частью растущей сети — будем рады познакомиться.
              </p>
              <p>
                Мы растем не ради денег. Мы создаем места, куда люди хотят
                возвращаться. И ищем партнеров, которые относятся к этому так же
                серьезно, как и мы.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="container-page pb-8">
        <div className="rounded-[1.75rem] bg-karimoff-black p-6 text-white shadow-[0_24px_70px_rgba(18,18,20,0.16)] sm:p-9">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <p className="max-w-3xl text-balance text-2xl font-black leading-tight sm:text-4xl">
              Если вам близок такой подход, давайте познакомимся.
            </p>
            <Link
              href="#lead"
              className="inline-flex rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.22)] transition hover:-translate-y-0.5 hover:bg-[#D95405]"
            >
              Оставить заявку на знакомство
            </Link>
          </div>
        </div>
      </section>

      <LeadForm defaultInterest="franchise" />
    </main>
  );
}
