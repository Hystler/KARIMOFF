import type { SiteSettings } from "@/lib/settings";
import type { ReactNode } from "react";

type SocialLinksProps = {
  settings: Pick<SiteSettings, "telegram_url" | "instagram_url" | "tiktok_url">;
};

const iconClassName = "h-5 w-5";

function getTelegramHref(url: string) {
  try {
    const parsed = new URL(url);
    const username = parsed.hostname === "t.me" ? parsed.pathname.replace(/^\/+/, "") : "";

    if (username) {
      return `tg://resolve?domain=${username}`;
    }
  } catch {
    return url;
  }

  return url;
}

function TelegramIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={iconClassName} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20.6 4.9 17.7 19c-.2 1-.8 1.2-1.6.8l-4.5-3.3-2.2 2.1c-.2.2-.4.4-.9.4l.3-4.6 8.4-7.6c.4-.3-.1-.5-.6-.2L6.3 13.1l-4.5-1.4c-1-.3-1-1 .2-1.4L19.5 3.6c.8-.3 1.5.2 1.1 1.3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={iconClassName} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="4.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16.8 7.3h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={iconClassName} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14.2 4v10.2a4.1 4.1 0 1 1-3.4-4v3a1.3 1.3 0 1 0 .9 1.2V4h2.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14.2 4c.5 2.7 2.2 4.3 4.8 4.7v3c-1.8-.1-3.4-.8-4.8-2" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function SocialLinks({ settings }: SocialLinksProps) {
  const links = [
    settings.telegram_url
      ? { label: "Telegram", href: getTelegramHref(settings.telegram_url), fallbackHref: settings.telegram_url, icon: <TelegramIcon /> }
      : null,
    settings.instagram_url
      ? { label: "Instagram", href: settings.instagram_url, fallbackHref: settings.instagram_url, icon: <InstagramIcon /> }
      : null,
    settings.tiktok_url
      ? { label: "TikTok", href: settings.tiktok_url, fallbackHref: settings.tiktok_url, icon: <TikTokIcon /> }
      : null
  ].filter(Boolean) as Array<{ fallbackHref: string; href: string; icon: ReactNode; label: string }>;

  if (!links.length) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Социальные сети">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          data-fallback-href={link.fallbackHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-karimoff-line bg-white text-karimoff-black shadow-[0_10px_24px_rgba(18,18,20,0.05)] transition hover:-translate-y-0.5 hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange"
          aria-label={link.label}
        >
          {link.icon}
        </a>
      ))}
    </div>
  );
}
