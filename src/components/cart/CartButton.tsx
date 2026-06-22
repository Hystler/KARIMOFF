"use client";

import { useCart } from "./CartProvider";

export function CartButton() {
  const { openCart, totalItems } = useCart();

  return (
    <button
      type="button"
      onClick={openCart}
      aria-label="Открыть корзину"
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-karimoff-orange/30 bg-white text-karimoff-black shadow-[0_10px_24px_rgba(18,18,20,0.06)] transition hover:-translate-y-0.5 hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0 sm:h-12 sm:w-12"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5.5 10.25H18.5L17.25 19.25H6.75L5.5 10.25Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M8.25 10.25L11 4.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M15.75 10.25L13 4.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M8.8 13.6H15.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9.35 16.45H14.65" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {totalItems > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-karimoff-orange px-1 text-[11px] font-black text-white">
          {totalItems}
        </span>
      ) : null}
    </button>
  );
}
