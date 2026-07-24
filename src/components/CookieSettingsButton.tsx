"use client";

export function CookieSettingsButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("karimoff-open-cookie-settings"))}
      className="text-left text-xs font-semibold text-karimoff-muted transition hover:text-karimoff-orange"
    >
      Настройки cookies
    </button>
  );
}
