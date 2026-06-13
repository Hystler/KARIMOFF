import Link from "next/link";
import { Logo } from "./Logo";

const footerMenu = [
  { label: "Меню", href: "/menu" },
  { label: "Для бизнеса", href: "/business" },
  { label: "Работа", href: "/careers" },
  { label: "Франшиза", href: "/franchise" },
  { label: "О бренде", href: "/about" }
];

export function Footer() {
  return (
    <footer className="border-t border-karimoff-line bg-white text-karimoff-black">
      <div className="container-page grid gap-8 py-10 sm:grid-cols-[1.1fr_0.9fr_1fr]">
        <div>
          <Logo compact />
          <p className="mt-4 max-w-sm text-sm leading-6 text-karimoff-muted">
            Premium fast food бренд с ресторанным вкусом, быстрой выдачей и
            готовой системой для роста.
          </p>
        </div>
        <nav className="grid gap-3" aria-label="Навигация в подвале">
          {footerMenu.map((item) => (
            <Link key={item.href} href={item.href} className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="text-sm leading-7 text-karimoff-muted">
          <p className="font-black text-karimoff-black">Контакты</p>
          <p>Телефон: +7 (000) 000-00-00</p>
          <p>Email: hello@karimoff.example</p>
          <p>Адрес: город, улица, дом</p>
        </div>
      </div>
      <div className="border-t border-karimoff-line">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-karimoff-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 KARIMOFF. Все права защищены.</p>
          <p>Информация на сайте не является публичной офертой.</p>
        </div>
      </div>
    </footer>
  );
}
