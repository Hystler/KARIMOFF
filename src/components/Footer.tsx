import Link from "next/link";
import type { SiteSettings } from "@/lib/settings";
import { Logo } from "./Logo";
import { SocialLinks } from "./SocialLinks";

const footerMenu = [
  { label: "Меню", href: "/menu" },
  { label: "Для бизнеса", href: "/business" },
  { label: "Работа", href: "/careers" },
  { label: "Франшиза", href: "/franchise" },
  { label: "О бренде", href: "/about" }
];

export function Footer({ settings }: { settings: SiteSettings }) {
  return (
    <footer className="border-t border-karimoff-line bg-white text-karimoff-black">
      <div className="container-page grid gap-8 py-10 sm:grid-cols-[1.1fr_0.9fr_1fr]">
        <div>
          <Logo compact />
          <p className="mt-4 max-w-sm text-sm leading-6 text-karimoff-muted">
            Бургерная с ресторанным вкусом, быстрой выдачей и готовой системой
            для роста.
          </p>
          <div className="mt-5">
            <SocialLinks settings={settings} />
          </div>
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
          {settings.phone ? <p>Телефон: {settings.phone}</p> : null}
          {settings.address ? <p>Адрес: {settings.address}</p> : null}
          {settings.working_hours ? <p>Часы работы: {settings.working_hours}</p> : null}
          {!settings.phone && !settings.address && !settings.working_hours ? (
            <p>Контакты появятся здесь после заполнения настроек.</p>
          ) : null}
        </div>
      </div>
      <div className="border-t border-karimoff-line">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-karimoff-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 {settings.site_name}. Все права защищены.</p>
          <p>Информация на сайте не является публичной офертой.</p>
        </div>
      </div>
    </footer>
  );
}
