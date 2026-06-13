"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CartButton } from "./cart/CartButton";
import { Logo } from "./Logo";

const navItems = [
  { label: "Меню", href: "/menu" },
  { label: "Для бизнеса", href: "/business" },
  { label: "Работа в KARIMOFF", href: "/careers" },
  { label: "Франшиза", href: "/franchise" },
  { label: "О нас", href: "/about" }
];

export function Header() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-karimoff-line bg-white/92 backdrop-blur-xl">
      <div className="container-page flex h-[72px] items-center justify-between gap-4">
        <Logo />

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Основная навигация">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-karimoff-muted transition hover:text-karimoff-black"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <CartButton />
          <Link
            href="/admin/login"
            className="rounded-full border border-karimoff-black/20 bg-white px-5 py-2.5 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
          >
            Войти / Регистрация
          </Link>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <CartButton />
          <button
            type="button"
            aria-label={isOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={isOpen}
            onClick={() => setIsOpen((value) => !value)}
            className="flex h-11 w-11 flex-col items-center justify-center gap-1.5 rounded-full border border-karimoff-black/15 bg-white"
          >
            <span className={cn("h-0.5 w-5 rounded-full bg-karimoff-black transition", isOpen && "translate-y-2 rotate-45")} />
            <span className={cn("h-0.5 w-5 rounded-full bg-karimoff-black transition", isOpen && "opacity-0")} />
            <span className={cn("h-0.5 w-5 rounded-full bg-karimoff-black transition", isOpen && "-translate-y-2 -rotate-45")} />
          </button>
        </div>
      </div>

      {isOpen ? (
        <div className="border-t border-karimoff-line bg-white lg:hidden">
          <nav className="container-page flex flex-col gap-1 py-4" aria-label="Мобильная навигация">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className="rounded-lg px-1 py-3 text-base font-semibold text-karimoff-black"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 border-t border-karimoff-line pt-4">
              <Link href="/admin/login" onClick={() => setIsOpen(false)} className="inline-flex rounded-full border border-karimoff-black/20 px-5 py-3 text-sm font-semibold text-karimoff-black">
                Войти / Регистрация
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
