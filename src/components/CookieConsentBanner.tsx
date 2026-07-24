"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "karimoff_cookie_consent";
const COOKIE_NAME = "karimoff_cookie_consent";
const MAX_AGE = 60 * 60 * 24 * 365;

type CookieCategories = {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
};

type SavedChoice = {
  categories: CookieCategories;
  consentId: string;
  savedAt: string;
};

function createConsentId() {
  return crypto.randomUUID();
}

function readSavedChoice(): SavedChoice | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as SavedChoice) : null;
  } catch {
    return null;
  }
}

function setConsentCookie(consentId: string) {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(consentId)}; path=/; max-age=${MAX_AGE}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
}

export function CookieConsentBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  const openSettings = useCallback(() => {
    const saved = readSavedChoice();
    setAnalytics(saved?.categories.analytics ?? false);
    setMarketing(saved?.categories.marketing ?? false);
    setIsVisible(true);
    setIsSettingsOpen(true);
  }, []);

  useEffect(() => {
    const saved = readSavedChoice();
    const hasCookie = document.cookie.split(";").some((item) => item.trim().startsWith(`${COOKIE_NAME}=`));
    const visibilityTimeout = window.setTimeout(() => setIsVisible(!saved || !hasCookie), 0);

    window.addEventListener("karimoff-open-cookie-settings", openSettings);
    return () => {
      window.clearTimeout(visibilityTimeout);
      window.removeEventListener("karimoff-open-cookie-settings", openSettings);
    };
  }, [openSettings]);

  async function saveConsent(categories: CookieCategories) {
    const previous = readSavedChoice();
    const consentId = previous?.consentId || createConsentId();
    const choice: SavedChoice = { categories, consentId, savedAt: new Date().toISOString() };

    setIsSaving(true);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    setConsentCookie(consentId);
    setIsVisible(false);
    setIsSettingsOpen(false);

    try {
      await fetch("/api/cookie-consent", {
        body: JSON.stringify({
          accepted: categories.analytics || categories.marketing,
          categories,
          consentId,
          pageUrl: window.location.pathname
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className="fixed inset-x-0 bottom-0 z-[80] px-3 pb-3 sm:px-6 sm:pb-6"
          role="dialog"
          aria-modal="true"
          aria-label="Настройки cookies"
        >
          <div className="mx-auto max-w-5xl rounded-lg border border-white/10 bg-karimoff-black p-4 text-white shadow-[0_24px_80px_rgba(18,18,20,0.42)] sm:p-6">
            <div className="flex flex-col gap-5">
              <div className="max-w-3xl">
                <p className="text-sm font-black text-karimoff-orange">Cookies</p>
                <h2 className="mt-1 text-xl font-black sm:text-2xl">Ваш выбор важен</h2>
                <p className="mt-2 text-sm leading-6 text-white/72">
                  Необходимые cookies поддерживают корзину, вход и безопасность. Аналитические и
                  маркетинговые выключены, пока вы сами их не разрешите.{" "}
                  <Link href="/legal/cookies" className="font-bold text-karimoff-orange">
                    Политика cookies
                  </Link>
                </p>
              </div>

              {isSettingsOpen ? (
                <div className="grid gap-3">
                  <div className="flex items-start justify-between gap-4 rounded-lg border border-white/12 bg-white/5 p-4">
                    <div>
                      <p className="font-bold">Необходимые</p>
                      <p className="mt-1 text-sm leading-6 text-white/65">Сессия, корзина, безопасность и сохранение выбора.</p>
                    </div>
                    <span className="text-sm font-bold text-karimoff-orange">Всегда включены</span>
                  </div>
                  <label className="flex items-start justify-between gap-4 rounded-lg border border-white/12 bg-white/5 p-4">
                    <span>
                      <span className="block font-bold">Аналитические</span>
                      <span className="mt-1 block text-sm leading-6 text-white/65">Сервис аналитики пока не подключён.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={analytics}
                      onChange={(event) => setAnalytics(event.target.checked)}
                      className="mt-1 h-5 w-5 accent-karimoff-orange"
                    />
                  </label>
                  <label className="flex items-start justify-between gap-4 rounded-lg border border-white/12 bg-white/5 p-4">
                    <span>
                      <span className="block font-bold">Маркетинговые</span>
                      <span className="mt-1 block text-sm leading-6 text-white/65">Для будущих рекламных интеграций; сейчас скрипты не загружаются.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={marketing}
                      onChange={(event) => setMarketing(event.target.checked)}
                      className="mt-1 h-5 w-5 accent-karimoff-orange"
                    />
                  </label>
                </div>
              ) : null}

              <div className="grid gap-2 sm:flex sm:flex-wrap">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => saveConsent({ necessary: true, analytics: true, marketing: true })}
                  className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white transition hover:bg-[#D95405] disabled:opacity-60"
                >
                  Принять все
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => saveConsent({ necessary: true, analytics: false, marketing: false })}
                  className="rounded-full border border-white/20 px-5 py-3 text-sm font-bold text-white transition hover:border-karimoff-orange hover:text-karimoff-orange disabled:opacity-60"
                >
                  Только необходимые
                </button>
                {isSettingsOpen ? (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => saveConsent({ necessary: true, analytics, marketing })}
                    className="rounded-full border border-white/20 px-5 py-3 text-sm font-bold text-white transition hover:border-karimoff-orange hover:text-karimoff-orange disabled:opacity-60"
                  >
                    Сохранить выбор
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={openSettings}
                    className="rounded-full border border-white/20 px-5 py-3 text-sm font-bold text-white transition hover:border-karimoff-orange hover:text-karimoff-orange"
                  >
                    Настроить
                  </button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
