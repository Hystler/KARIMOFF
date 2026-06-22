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

export default function AboutPage() {
  return (
    <main className="bg-karimoff-cream pt-24 text-karimoff-black">
      <section className="container-page pb-14 pt-8 sm:pb-20 sm:pt-12">
        <div className="grid gap-8 rounded-[1.75rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">О нас</p>
            <h1 className="mt-4 text-balance text-4xl font-black leading-[0.96] sm:text-6xl">
              Почему люди возвращаются в KARIMOFF?
            </h1>
          </div>
          <p className="max-w-xl text-base leading-7 text-karimoff-muted sm:text-lg">
            Мы строим бургерную на простом принципе: хороший продукт,
            стабильный вкус и уважение к каждому гостю.
          </p>
        </div>
      </section>

      <section className="container-page pb-14 sm:pb-20">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">Почему возвращаются</p>
            <h2 className="mt-3 text-balance text-3xl font-black leading-tight sm:text-5xl">
              Без лишних обещаний и красивых историй
            </h2>
          </div>
          <div className="grid gap-5 text-base leading-8 text-karimoff-muted">
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

      <section className="container-page pb-14 sm:pb-20">
        <div className="mb-8 max-w-3xl">
          <p className="text-sm font-semibold text-karimoff-orange">Три принципа</p>
          <h2 className="mt-3 text-balance text-3xl font-black leading-tight sm:text-5xl">
            На этом построен KARIMOFF
          </h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {principles.map((principle) => (
            <article
              key={principle.title}
              className="rounded-[1.25rem] border border-karimoff-line bg-white p-6 shadow-[0_18px_50px_rgba(18,18,20,0.07)]"
            >
              <div className="mb-5 h-1.5 w-12 rounded-full bg-karimoff-orange" />
              <h3 className="text-2xl font-black">{principle.title}</h3>
              <p className="mt-4 text-sm leading-7 text-karimoff-muted">{principle.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="container-page pb-14 sm:pb-20">
        <div className="rounded-[1.75rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-10">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold text-karimoff-orange">Главный принцип</p>
            <h2 className="mt-3 text-balance text-3xl font-black leading-tight sm:text-5xl">
              Чтобы вам хотелось вернуться
            </h2>
          </div>
          <div className="mt-8 grid gap-5 text-base leading-8 text-karimoff-muted lg:grid-cols-3">
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
        <div className="rounded-[1.75rem] bg-karimoff-black p-6 text-white shadow-[0_24px_70px_rgba(18,18,20,0.16)] sm:p-10">
          <p className="max-w-4xl text-balance text-3xl font-black leading-tight sm:text-5xl">
            KARIMOFF — сеть бургерных, построенная на простом принципе:
            хорошая еда, нормальная цена и уважение к каждому гостю.
          </p>
        </div>
      </section>
    </main>
  );
}
