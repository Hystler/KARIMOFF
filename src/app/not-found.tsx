import Link from "next/link";

function LostBurgerIllustration() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[360px]">
      <div className="absolute inset-x-8 top-10 h-14 rounded-[999px_999px_40px_40px] bg-karimoff-orange shadow-[0_22px_55px_rgba(251,103,10,0.24)]" />
      <div className="absolute left-16 right-16 top-[86px] h-4 rounded-full bg-white/90" />
      <div className="absolute left-10 right-10 top-[116px] h-8 rounded-full bg-[#121214]" />
      <div className="absolute left-14 right-14 top-[158px] h-10 rounded-[42px] bg-karimoff-orange/90" />
      <div className="absolute left-20 right-20 top-[210px] h-14 rounded-[40px_40px_999px_999px] bg-[#121214]" />

      <div className="absolute right-10 top-5 flex h-24 w-24 items-center justify-center rounded-full border-[6px] border-[#121214] bg-white shadow-[0_20px_45px_rgba(18,18,20,0.12)]">
        <span className="absolute -left-2 top-3 h-7 w-7 rounded-full bg-[#121214]" />
        <span className="absolute -right-2 top-3 h-7 w-7 rounded-full bg-[#121214]" />
        <span className="absolute left-7 top-9 h-5 w-4 rounded-full bg-[#121214]" />
        <span className="absolute right-7 top-9 h-5 w-4 rounded-full bg-[#121214]" />
        <span className="absolute top-14 h-2.5 w-3 rounded-full bg-[#121214]" />
        <span className="absolute bottom-5 h-2 w-8 rounded-b-full border-b-4 border-[#121214]" />
      </div>

      <div className="absolute bottom-8 left-6 right-6 h-3 rounded-full bg-karimoff-black/10" />
    </div>
  );
}

export default function NotFound() {
  return (
    <main className="min-h-screen bg-karimoff-cream pt-28 text-karimoff-black">
      <section className="container-page pb-16 pt-8">
        <div className="grid min-h-[calc(100vh-11rem)] grid-cols-1 items-center gap-8 rounded-[1.75rem] border border-karimoff-line bg-white p-6 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="order-2 min-w-0 lg:order-1">
            <p className="text-sm font-semibold text-karimoff-orange">Страница не найдена</p>
            <h1 className="mt-4 max-w-2xl text-balance text-4xl font-black leading-[1.02] sm:text-6xl">
              404. Бургер потерялся
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-karimoff-muted sm:text-lg sm:leading-8">
              Похоже, эта страница ушла на кухню и не вернулась. Вернём вас
              туда, где точно есть еда и понятный маршрут.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/"
                className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.20)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
              >
                Вернуться на главную
              </Link>
              <Link
                href="/menu"
                className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-karimoff-black/20 bg-white px-6 py-3 text-sm font-bold text-karimoff-black shadow-[0_12px_28px_rgba(18,18,20,0.08)] transition hover:-translate-y-0.5 hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
              >
                Открыть меню
              </Link>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <LostBurgerIllustration />
          </div>
        </div>
      </section>
    </main>
  );
}
