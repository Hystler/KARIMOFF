import Link from "next/link";
import type { SiteSettings } from "@/lib/settings";
import { Logo } from "./Logo";
import { SocialLinks } from "./SocialLinks";
import { CookieSettingsButton } from "./CookieSettingsButton";
import { LEGAL_CONTACTS } from "@/lib/legal";

const footerMenu = [
  { label: "Меню", href: "/menu" },
  { label: "Для бизнеса", href: "/business" },
  { label: "Работа", href: "/careers" },
  { label: "Франшиза", href: "/franchise" },
  { label: "О бренде", href: "/about" }
];

const legalMenu = [
  { label: "Оферта", href: "/legal/offer" },
  { label: "Политика ПД", href: "/legal/privacy" },
  { label: "Согласие на обработку ПД", href: "/legal/personal-data-consent" },
  { label: "Cookies", href: "/legal/cookies" },
  { label: "Доставка и возврат", href: "/legal/delivery" },
  { label: "Правила лояльности", href: "/legal/loyalty" },
  { label: "Реквизиты", href: "/legal/requisites" }
];

export function Footer({ settings }: { settings: SiteSettings }) {
  return (
    <footer className="border-t border-karimoff-line bg-white text-karimoff-black">
      <div className="container-page grid gap-8 py-10 sm:grid-cols-[1.1fr_0.9fr_1fr]">
        <div>
          <Logo compact />
          <p className="mt-4 max-w-sm text-sm leading-6 text-karimoff-muted">
            Первый фастфуд, приготовленный для вас с любовью
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
        <div className="container-page grid gap-5 py-6 text-xs text-karimoff-muted">
          <nav className="flex flex-wrap gap-x-5 gap-y-3" aria-label="Юридическая информация">
            {legalMenu.map((item) => (
              <Link key={item.href} href={item.href} className="font-semibold transition hover:text-karimoff-orange">
                {item.label}
              </Link>
            ))}
            <CookieSettingsButton />
          </nav>
          <div className="grid gap-1 leading-5 sm:grid-cols-[1fr_auto] sm:items-end sm:gap-8">
            <div>
              <p className="font-bold text-karimoff-black">{LEGAL_CONTACTS.operator}</p>
              <p>ИНН {LEGAL_CONTACTS.inn} · ОГРНИП {LEGAL_CONTACTS.ogrnip}</p>
              <p>{LEGAL_CONTACTS.supportPhone} · {LEGAL_CONTACTS.supportEmail}</p>
            </div>
            <p>© 2026 {settings.site_name}. Все права защищены.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
