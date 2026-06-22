"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

const STORAGE_KEY = "karimoff_cookie_consent";
const COOKIE_NAME = "karimoff_cookie_consent";
const MAX_AGE = 60 * 60 * 24 * 365;

function createConsentId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `consent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setConsentCookie(consentId: string) {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(consentId)}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}

export function CookieConsentBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      const hasCookie = document.cookie.split(";").some((item) => item.trim().startsWith(`${COOKIE_NAME}=`));

      if (!saved && !hasCookie) {
        setIsVisible(true);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  async function saveConsent(categories: Record<string, boolean>) {
    const consentId = createConsentId();
    setIsSaving(true);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ categories, consentId, savedAt: new Date().toISOString() }));
    setConsentCookie(consentId);
    setIsVisible(false);

    try {
      await fetch("/api/cookie-consent", {
        body: JSON.stringify({
          accepted: true,
          categories,
          consentId,
          pageUrl: window.location.href
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
    } catch {
      // Consent is still stored locally; network errors should not trap the user in the banner.
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
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="fixed inset-x-0 bottom-0 z-[70] px-4 pb-4 sm:px-6 sm:pb-6"
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-4 rounded-2xl border border-white/10 bg-karimoff-black p-4 text-white shadow-[0_24px_80px_rgba(18,18,20,0.35)] sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="max-w-2xl">
              <p className="text-sm font-black text-karimoff-orange">Cookies</p>
              <p className="mt-1 text-sm font-semibold leading-6 sm:text-base">
                Мы используем cookies, чтобы сайт работал корректно и становился лучше.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => saveConsent({ necessary: true, analytics: false })}
                className="rounded-full border border-white/20 px-5 py-3 text-sm font-bold text-white transition hover:border-karimoff-orange hover:text-karimoff-orange disabled:opacity-60"
              >
                Только необходимые
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => saveConsent({ necessary: true, analytics: true })}
                className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.24)] transition hover:-translate-y-0.5 hover:bg-[#D95405] disabled:opacity-60"
              >
                Принять
              </button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
