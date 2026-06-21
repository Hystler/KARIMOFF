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
    <main className="min-h-screen bg-karimoff-cream pt-28 text-karimoff-black">
      <section className="container-page pb-16">
        <div className="rounded-[1.5rem] border border-karimoff-line bg-white p-7 shadow-[0_24px_70px_rgba(18,18,20,0.08)]">
          <p className="text-sm font-semibold text-karimoff-orange">Checkout</p>
          <h1 className="mt-3 text-4xl font-black leading-none sm:text-6xl">Оформление заказа</h1>
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
