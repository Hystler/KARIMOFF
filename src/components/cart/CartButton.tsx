"use client";

import { useCart } from "./CartProvider";

export function CartButton() {
  const { openCart, totalItems } = useCart();

  return (
    <button
      type="button"
      onClick={openCart}
      aria-label="Открыть корзину"
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-karimoff-orange/25 bg-white text-karimoff-black shadow-[0_10px_24px_rgba(18,18,20,0.06)] transition hover:-translate-y-0.5 hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 10.5H18L16.8 19H7.2L6 10.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8.5 10.5L11 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M15.5 10.5L13 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9 13.5H15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M9.5 16.5H14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {totalItems > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-karimoff-orange px-1 text-[11px] font-black text-white">
          {totalItems}
        </span>
      ) : null}
    </button>
  );
}
