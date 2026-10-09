"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { LEGAL_VERSION } from "@/lib/legal";

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
  documentVersion: string;
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
  const { isOpen: isCartOpen } = useCart();
  const reduceMotion = useReducedMotion() ?? false;
  const bannerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    const isCurrent = saved?.documentVersion === LEGAL_VERSION;
    const visibilityTimeout = window.setTimeout(() => setIsVisible(!saved || !hasCookie || !isCurrent), 0);

    window.addEventListener("karimoff-open-cookie-settings", openSettings);
    return () => {
      window.clearTimeout(visibilityTimeout);
      window.removeEventListener("karimoff-open-cookie-settings", openSettings);
    };
  }, [openSettings]);

  useEffect(() => {
    if (!isVisible || isCartOpen || !bannerRef.current) return undefined;
    const banner = bannerRef.current;
    const updateOffset = () => {
      document.documentElement.style.setProperty("--cookie-consent-offset", `${banner.getBoundingClientRect().height}px`);
    };
    updateOffset();
    const resizeObserver = new ResizeObserver(updateOffset);
    resizeObserver.observe(banner);
    window.addEventListener("resize", updateOffset);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateOffset);
    };
  }, [isCartOpen, isSettingsOpen, isVisible]);

  async function saveConsent(categories: CookieCategories) {
    const previous = readSavedChoice();
    const consentId = previous?.consentId || createConsentId();
    const choice: SavedChoice = { categories, consentId, savedAt: new Date().toISOString(), documentVersion: LEGAL_VERSION };

    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await fetch("/api/cookie-consent", {
        body: JSON.stringify({
          accepted: categories.analytics || categories.marketing,
          categories,
          consentId,
          pageUrl: window.location.pathname
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const result = await response.json() as { ok?: boolean; stored?: boolean; localOnly?: boolean; error?: string };
      if (!response.ok || result.ok !== true || (result.stored !== true && result.localOnly !== true)) {
        setSaveError(result.error || "Не удалось сохранить выбор. Попробуйте ещё раз.");
        setIsVisible(true);
        return;
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
      setConsentCookie(consentId);
      setIsVisible(false);
      setIsSettingsOpen(false);
    } catch {
      setSaveError("Не удалось сохранить выбор. Проверьте подключение и попробуйте ещё раз.");
      setIsVisible(true);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AnimatePresence onExitComplete={() => document.documentElement.style.setProperty("--cookie-consent-offset", "0px")}>
      {isVisible && !isCartOpen ? (
        <motion.div
          ref={bannerRef}
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: "easeOut" }}
          className="cookie-consent-position fixed inset-x-0 bottom-0 z-[60] pt-3"
          role="region"
          aria-label="Настройки cookies"
        >
          <div className="mr-auto w-full max-w-lg rounded-panel border border-white/10 bg-karimoff-black p-4 text-white shadow-overlay sm:p-6">
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
                  className="public-button-primary px-5"
                >
                  Принять все
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => saveConsent({ necessary: true, analytics: false, marketing: false })}
                  className="public-button-on-dark px-5"
                >
                  Только необходимые
                </button>
                {isSettingsOpen ? (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => saveConsent({ necessary: true, analytics, marketing })}
                    className="public-button-on-dark px-5"
                  >
                    Сохранить выбор
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={openSettings}
                    className="public-button-on-dark px-5"
                  >
                    Настроить
                  </button>
                )}
              </div>
              {saveError ? <p role="alert" className="text-sm font-semibold text-red-300">{saveError}</p> : null}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
