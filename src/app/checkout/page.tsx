"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function CheckoutPage() {
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.dispatchEvent(new Event("karimoff-cart-checkout-request"));
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <main className="min-h-screen bg-karimoff-cream pt-24 text-karimoff-black sm:pt-28">
      <section className="container-page pb-16">
        <div className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:p-7">
          <p className="text-sm font-semibold text-karimoff-orange">Заказ</p>
          <h1 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">Оформление заказа</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-karimoff-muted">
            Открываем корзину. Если она пуста, вернитесь в меню и добавьте позиции.
          </p>
          <Link
            href="/menu"
            className="mt-7 inline-flex rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.22)] transition hover:-translate-y-0.5 hover:bg-[#D95405]"
          >
            Перейти в меню
          </Link>
        </div>
      </section>
    </main>
  );
}
