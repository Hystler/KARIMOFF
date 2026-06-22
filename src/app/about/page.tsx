import { PageHero } from "@/components/PageHero";
import { getSiteSettings } from "@/lib/settings";

const principles = [
  {
    title: "Честный продукт",
    text: "Мы не экономим на том, что влияет на вкус. «Если мы готовы накормить этим собственного ребенка, значит это можно продавать»."
  },
  {
    title: "Открытая кухня",
    text: "Нам нечего скрывать. Гость должен видеть и знать, как готовится его заказ."
  },
  {
    title: "Единый стандарт",
    text: "Каждый бургер собирается по собственной уникальной рецептуре. Не по настроению сотрудника, а по понятным правилам, граммовке и регламентам."
  }
];

export default async function AboutPage() {
  const settings = await getSiteSettings();

  return (
    <main className="bg-karimoff-cream text-karimoff-black">
      <PageHero
        eyebrow="О нас"
        title="Почему люди возвращаются в KARIMOFF?"
        subtitle="Мы строим бургерную на простом принципе: хороший продукт, стабильный вкус и уважение к каждому гостю."
        imageUrl={settings.about_hero_image_url}
        objectPosition="center"
      />

      <section className="container-page py-10 sm:py-16">
        <div className="grid grid-cols-1 gap-7 lg:grid-cols-[0.72fr_1fr]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-karimoff-orange">Почему возвращаются</p>
            <h2 className="mt-3 max-w-xl text-balance text-3xl font-black leading-tight sm:text-4xl">
              Без лишних обещаний и красивых историй
            </h2>
          </div>
          <div className="grid min-w-0 max-w-[760px] grid-cols-1 gap-5 text-[17px] leading-8 text-karimoff-muted sm:text-lg">
            <p>
              В общепите много обещаний и красивых картинок с едой. Мы выбрали
              другой путь.
            </p>
            <p>
              Мы не называем себя премиальным брендом. Не придумываем сложные
              истории про гастрономические открытия. Мы просто считаем, что
              хороший бургер должен быть вкусным, сытным и стоить разумных денег.
            </p>
            <p>
              Поэтому каждый день делаем одну простую вещь: соблюдаем стандарты.
              Чтобы сегодня, завтра и через год вы получили тот же вкус, за
              которым пришли.
            </p>
          </div>
        </div>
      </section>

      <section className="container-page pb-12 sm:pb-16">
        <div className="mb-7 max-w-3xl">
          <p className="text-sm font-semibold text-karimoff-orange">Три принципа</p>
          <h2 className="mt-3 text-balance text-3xl font-black leading-tight sm:text-4xl">
            На этом построен KARIMOFF
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {principles.map((principle) => (
            <article
              key={principle.title}
              className="rounded-[1.25rem] border border-karimoff-line bg-white p-6 shadow-[0_18px_50px_rgba(18,18,20,0.07)] transition hover:-translate-y-0.5 hover:border-karimoff-orange/40"
            >
              <div className="mb-5 h-1.5 w-12 rounded-full bg-karimoff-orange" />
              <h3 className="text-2xl font-black">{principle.title}</h3>
              <p className="mt-4 text-sm leading-7 text-karimoff-muted">{principle.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="container-page pb-12 sm:pb-16">
        <div className="rounded-[1.75rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-9">
          <div className="max-w-[760px]">
            <p className="text-sm font-semibold text-karimoff-orange">Главный принцип</p>
            <h2 className="mt-3 text-balance text-3xl font-black leading-tight sm:text-4xl">
              Чтобы вам хотелось вернуться
            </h2>
          </div>
          <div className="mt-7 grid grid-cols-1 gap-5 text-[17px] leading-8 text-karimoff-muted lg:grid-cols-3">
            <p>
              Новый гость приходит из любопытства. Постоянный — потому что
              получил именно то, на что рассчитывал.
            </p>
            <p>
              Поэтому мы уделяем внимание не только вкусу, но и скорости
              приготовления, чистоте, сервису и стабильности качества.
            </p>
            <p>
              Когда человек выбирает KARIMOFF второй раз, мы понимаем, что
              движемся в правильном направлении.
            </p>
          </div>
        </div>
      </section>

      <section className="container-page pb-20">
        <div className="rounded-[1.75rem] bg-karimoff-black p-6 text-white shadow-[0_24px_70px_rgba(18,18,20,0.16)] sm:p-9">
          <div className="mb-5 h-1.5 w-14 rounded-full bg-karimoff-orange" />
          <p className="max-w-4xl text-balance text-2xl font-black leading-tight sm:text-4xl">
            KARIMOFF — сеть бургерных, построенная на простом принципе:
            хорошая еда, нормальная цена и уважение к каждому гостю.
          </p>
        </div>
      </section>
    </main>
  );
}
