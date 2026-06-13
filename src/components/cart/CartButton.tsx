"use client";

import { useCart } from "./CartProvider";

export function CartButton() {
  const { openCart, totalItems } = useCart();

  return (
    <button
      type="button"
      onClick={openCart}
      aria-label="Открыть корзину"
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-karimoff-black/15 bg-white text-karimoff-black transition hover:-translate-y-0.5 hover:border-karimoff-orange hover:text-karimoff-orange"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 8h10l-1 10H8L7 8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 8a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {totalItems > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-karimoff-orange px-1 text-[11px] font-black text-white">
          {totalItems}
        </span>
      ) : null}
    </button>
  );
}
