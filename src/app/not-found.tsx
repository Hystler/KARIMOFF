import Link from "next/link";
import { ArrowRight, Home } from "lucide-react";

export default function NotFound() {
  return (
    <main className="not-found-premium relative isolate min-h-screen overflow-hidden bg-[#101011] px-5 pb-10 pt-24 text-white sm:px-8 sm:pt-28">
      <div className="not-found-grid absolute inset-0 -z-10 opacity-50" aria-hidden="true" />
      <section className="mx-auto grid min-h-[calc(100vh-8rem)] w-full max-w-6xl items-center gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.72fr)] lg:gap-16">
        <div className="min-w-0">
          <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 text-xs font-bold text-white/70">
            <span className="h-2 w-2 rounded-full bg-karimoff-orange shadow-[0_0_16px_rgba(251,103,10,0.8)]" aria-hidden="true" />
            Статус заказа
          </div>
          <h1 className="mt-7 max-w-3xl text-4xl font-black leading-[1.04] sm:text-6xl lg:text-7xl">
            Заказ №404
            <span className="mt-2 block text-karimoff-orange">не найден</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-white/60 sm:text-lg sm:leading-8">
            Похоже, его уже забрали. Вернитесь к меню или начните маршрут с главной страницы.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/menu"
              className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3 text-sm font-bold text-white shadow-[0_18px_42px_rgba(251,103,10,0.24)] transition hover:-translate-y-0.5 hover:bg-[#E85B05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-karimoff-orange active:translate-y-0"
            >
              В меню
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border border-white/20 bg-white/[0.05] px-6 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white active:translate-y-0"
            >
              <Home aria-hidden="true" size={18} />
              На главную
            </Link>
          </div>
        </div>

        <div className="not-found-ticket relative mx-auto w-full max-w-[430px] overflow-hidden rounded-lg border border-white/15 bg-[#181819] shadow-[0_38px_100px_rgba(0,0,0,0.48)]" aria-label="Талон заказа 404, заказ не найден">
          <div className="flex items-center justify-between border-b border-dashed border-white/15 px-5 py-4 text-[11px] font-bold uppercase text-white/45 sm:px-7">
            <span>KARIMOFF</span>
            <span>Pickup #404</span>
          </div>
          <div className="px-5 py-9 sm:px-7 sm:py-12">
            <p className="text-xs font-bold uppercase text-white/45">Номер заказа</p>
            <p className="not-found-number mt-2 text-[104px] font-black leading-none text-white sm:text-[138px]" aria-hidden="true">404</p>
            <div className="mt-7 flex items-center justify-between gap-4 border-t border-white/10 pt-5">
              <div>
                <p className="text-xs font-bold text-white/45">Состояние</p>
                <p className="mt-1 text-sm font-black text-karimoff-orange">НЕ НАЙДЕН</p>
              </div>
              <span className="not-found-scan h-11 w-11 rounded-full border border-karimoff-orange/45" aria-hidden="true" />
            </div>
          </div>
          <div className="not-found-ticker overflow-hidden border-t border-white/10 bg-black/30 py-3" aria-hidden="true">
            <div className="not-found-ticker-track flex w-max items-center gap-7 whitespace-nowrap px-5 text-xs font-bold text-white/45">
              <span>A-042 <b className="text-emerald-400">готов</b></span>
              <span>B-017 <b className="text-amber-300">готовится</b></span>
              <span>404 <b className="text-karimoff-orange">не найден</b></span>
              <span>A-042 <b className="text-emerald-400">готов</b></span>
              <span>B-017 <b className="text-amber-300">готовится</b></span>
              <span>404 <b className="text-karimoff-orange">не найден</b></span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
