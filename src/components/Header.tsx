"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentCustomerAction } from "@/app/actions/orders";
import { cn } from "@/lib/utils";
import { CartButton } from "./cart/CartButton";
import { Logo } from "./Logo";
import { ThemeToggle } from "./theme/ThemeToggle";

const navItems = [
  { label: "Меню", href: "/menu" },
  { label: "Для бизнеса", href: "/business" },
  { label: "Работа в KARIMOFF", href: "/careers" },
  { label: "Франшиза", href: "/franchise" },
  { label: "О нас", href: "/about" }
];

export function Header() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [customerName, setCustomerName] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    getCurrentCustomerAction()
      .then((customer) => {
        if (isMounted) {
          setCustomerName(customer?.name ?? null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setCustomerName(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  function isActiveRoute(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-karimoff-black/10 bg-[rgba(255,255,255,0.96)] shadow-[0_12px_40px_rgba(18,18,20,0.08)] backdrop-blur-xl">
      <div className="container-page flex h-[68px] items-center justify-between gap-3 sm:h-[74px] sm:gap-4">
        <Logo />

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Основная навигация">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActiveRoute(item.href) ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-1.5 py-2 text-[15px] font-semibold text-karimoff-black transition hover:text-karimoff-orange",
                isActiveRoute(item.href) && "text-karimoff-orange"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <ThemeToggle />
          <CartButton />
          <Link
            href={customerName ? "/profile" : "/login"}
            className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(251,103,10,0.18)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
          >
            {customerName ? "Профиль" : "Войти / Регистрация"}
          </Link>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <ThemeToggle />
          <CartButton />
          <button
            type="button"
            aria-label={isOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={isOpen}
            onClick={() => setIsOpen((value) => !value)}
            className="flex h-11 w-11 flex-col items-center justify-center gap-1.5 rounded-full border border-karimoff-black/15 bg-white text-karimoff-black shadow-[0_10px_24px_rgba(18,18,20,0.06)] sm:h-12 sm:w-12"
          >
            <span className={cn("h-0.5 w-5 rounded-full bg-current transition", isOpen && "translate-y-2 rotate-45")} />
            <span className={cn("h-0.5 w-5 rounded-full bg-current transition", isOpen && "opacity-0")} />
            <span className={cn("h-0.5 w-5 rounded-full bg-current transition", isOpen && "-translate-y-2 -rotate-45")} />
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
                aria-current={isActiveRoute(item.href) ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-3 text-base font-semibold text-karimoff-black transition hover:bg-karimoff-soft hover:text-karimoff-orange",
                  isActiveRoute(item.href) && "bg-karimoff-soft text-karimoff-orange"
                )}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 border-t border-karimoff-line pt-4">
              <Link href={customerName ? "/profile" : "/login"} onClick={() => setIsOpen(false)} className="inline-flex rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white shadow-[0_12px_28px_rgba(251,103,10,0.18)] transition hover:bg-[#D95405]">
                {customerName ? "Профиль" : "Войти / Регистрация"}
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
