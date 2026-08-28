"use client";

import { Check, CircleAlert, LoaderCircle, Phone, ShieldCheck } from "lucide-react";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { SocialProviderIcon } from "@/components/auth/SocialProviderIcon";

type MaxContact = {
  authDate: string;
  hash: string;
  phone: string;
};

type MiniAppState =
  | { kind: "loading" }
  | { kind: "validating" }
  | { kind: "identity_valid" }
  | { kind: "needs_phone" }
  | { kind: "requesting_contact" }
  | { kind: "phone_denied"; message: string }
  | { kind: "success"; returnUrl: string }
  | { kind: "expired" }
  | { kind: "technical_error"; message: string };

declare global {
  interface Window {
    WebApp?: {
      initData: string;
      openLink: (url: string) => void;
      platform?: "android" | "desktop" | "ios" | "web";
      requestContact: () => Promise<MaxContact>;
      version?: string;
    };
  }
}

function challengeFromInitData(initData: string) {
  try {
    return new URLSearchParams(initData).get("start_param") ?? "";
  } catch {
    return "";
  }
}

function userMessage(code: string) {
  if (code === "contact_phone_invalid") return "Не удалось подтвердить номер. Попробуйте ещё раз.";
  if (code === "rate_limit") return "Слишком много попыток. Подождите немного и попробуйте снова.";
  return "Не удалось подтвердить вход. Вернитесь в KARIMOFF и попробуйте ещё раз.";
}

async function reportMiniAppEvent(
  challenge: string,
  event: "miniapp_loaded" | "contact_requested"
) {
  const bridge = window.WebApp;
  await fetch("/api/auth/social/max/event", {
    body: JSON.stringify({
      bridgePlatform: bridge?.platform ?? "unknown",
      bridgeVersion: bridge?.version?.slice(0, 32),
      challenge,
      event,
      requestContactAvailable: typeof bridge?.requestContact === "function"
    }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST"
  });
}

export function MaxMiniApp({ configured }: { configured: boolean }) {
  const startedRef = useRef(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [state, setState] = useState<MiniAppState>(configured ? { kind: "loading" } : {
    kind: "technical_error",
    message: "Вход через MAX пока не настроен."
  });

  const sendProof = useCallback(async (options?: { contact?: MaxContact }) => {
    const initData = window.WebApp?.initData ?? "";
    const challenge = challengeFromInitData(initData);
    if (!initData || !challenge) {
      setState({ kind: "technical_error", message: "Откройте этот экран через кнопку входа в KARIMOFF." });
      return;
    }
    setState(options?.contact ? { kind: "requesting_contact" } : { kind: "validating" });
    const response = await fetch("/api/auth/social/max/complete", {
      body: JSON.stringify({
        challenge,
        initData,
        ...(options?.contact ? { contact: options.contact } : {})
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = await response.json().catch(() => null) as {
      error?: string;
      ok?: boolean;
      returnUrl?: string;
      status?: "needs_contact" | "completed";
    } | null;
    if (!response.ok || !payload?.ok || !payload.status) {
      throw new Error(payload?.error || "technical");
    }
    if (payload.status === "needs_contact") {
      setState({ kind: "identity_valid" });
      return;
    }
    if (!payload.returnUrl) throw new Error("technical");
    setState({ kind: "success", returnUrl: payload.returnUrl });
  }, []);

  useEffect(() => {
    if (state.kind !== "identity_valid") return;
    const timeout = window.setTimeout(() => setState({ kind: "needs_phone" }), 450);
    return () => window.clearTimeout(timeout);
  }, [state.kind]);

  useEffect(() => {
    if (!configured || !scriptReady || startedRef.current) return;
    startedRef.current = true;
    const challenge = challengeFromInitData(window.WebApp?.initData ?? "");
    if (challenge) {
      void reportMiniAppEvent(challenge, "miniapp_loaded").catch(() => undefined);
    }
    void sendProof().catch((error) => {
      const code = error instanceof Error ? error.message : "technical";
      setState(code.includes("expired")
        ? { kind: "expired" }
        : { kind: "technical_error", message: userMessage(code) });
    });
  }, [configured, scriptReady, sendProof]);

  async function requestPhone() {
    if (!window.WebApp?.requestContact) {
      setState({ kind: "phone_denied", message: "Эта версия MAX не смогла открыть запрос номера." });
      return;
    }
    setState({ kind: "requesting_contact" });
    const challenge = challengeFromInitData(window.WebApp.initData);
    if (challenge) {
      void reportMiniAppEvent(challenge, "contact_requested").catch(() => undefined);
    }
    try {
      const contact = await window.WebApp.requestContact();
      await sendProof({ contact });
    } catch (error) {
      const code = (error as { error?: { code?: string } })?.error?.code ?? "";
      if (code.includes("user_refused_provide_phone_number")) {
        setState({ kind: "phone_denied", message: "Вы не передали номер. Аккаунт MAX уже подтверждён." });
        return;
      }
      const message = error instanceof Error && error.message.startsWith("contact_")
        ? "Не удалось безопасно подтвердить номер. Аккаунт MAX уже подтверждён."
        : "MAX не смог передать номер. Аккаунт MAX уже подтверждён.";
      setState({ kind: "phone_denied", message });
    }
  }

  function returnToKarimoff(url: string) {
    if (window.WebApp?.openLink) {
      window.WebApp.openLink(url);
      return;
    }
    window.location.assign(url);
  }

  const busy = ["loading", "validating", "requesting_contact"].includes(state.kind);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0D001A] px-5 py-8 text-white">
      <Script
        id="max-web-app-bridge"
        src="https://st.max.ru/js/max-web-app.js"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => setState({ kind: "technical_error", message: "Не удалось открыть вход. Обновите экран и попробуйте ещё раз." })}
      />
      <section className="w-full max-w-md rounded-lg border border-white/15 bg-white p-6 text-[#0D001A] shadow-[0_28px_90px_rgba(0,0,0,0.34)] sm:p-8" aria-live="polite">
        <div className="flex items-center justify-between gap-4">
          <p className="font-heading text-xl font-black">KARIMOFF</p>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#471AFF] text-white shadow-[0_10px_24px_rgba(71,26,255,0.28)]">
            <SocialProviderIcon provider="max" className="h-7 w-7" />
          </span>
        </div>

        <div className="mt-8">
          {busy ? (
            <>
              <LoaderCircle className="animate-spin text-[#471AFF]" size={34} aria-hidden="true" />
              <h1 className="mt-5 text-3xl font-black leading-tight">Вход в KARIMOFF</h1>
              <p className="mt-3 text-base leading-7 text-black/60">
                {state.kind === "requesting_contact" ? "Подтверждаем ваш номер…" : "Подтверждаем ваш аккаунт…"}
              </p>
            </>
          ) : state.kind === "identity_valid" ? (
            <>
              <ShieldCheck className="text-[#471AFF]" size={36} aria-hidden="true" />
              <h1 className="mt-5 text-3xl font-black leading-tight">MAX подтверждён</h1>
              <p className="mt-3 text-base leading-7 text-black/60">Проверяем, нужен ли номер для связи с профилем KARIMOFF…</p>
            </>
          ) : state.kind === "needs_phone" ? (
            <>
              <ShieldCheck className="text-[#471AFF]" size={36} aria-hidden="true" />
              <h1 className="mt-5 text-3xl font-black leading-tight">MAX подтверждён</h1>
              <p className="mt-3 text-base leading-7 text-black/60">Осталось подтвердить номер телефона, чтобы связать аккаунт KARIMOFF.</p>
              <button
                type="button"
                onClick={() => void requestPhone()}
                className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#471AFF] px-5 py-3 text-sm font-black text-white transition hover:bg-[#5B2BFF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#471AFF]"
              >
                <Phone size={18} />
                Подтвердить номер
              </button>
              <p className="mt-4 text-center text-xs leading-5 text-black/50">MAX покажет системное окно. Номер используется только для вашего аккаунта KARIMOFF.</p>
            </>
          ) : state.kind === "phone_denied" ? (
            <>
              <ShieldCheck className="text-[#471AFF]" size={36} aria-hidden="true" />
              <h1 className="mt-5 text-3xl font-black leading-tight">Номер не передан</h1>
              <p className="mt-3 text-base leading-7 text-black/60">{state.message} Повторите запрос или вернитесь к входу по телефону с паролем.</p>
              <div className="mt-7 grid gap-3">
                <button
                  type="button"
                  onClick={() => void requestPhone()}
                  className="min-h-12 w-full rounded-lg bg-[#471AFF] px-5 py-3 text-sm font-black text-white transition hover:bg-[#5B2BFF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#471AFF]"
                >
                  Подтвердить номер ещё раз
                </button>
                <button
                  type="button"
                  onClick={() => returnToKarimoff(new URL("/login", window.location.origin).toString())}
                  className="min-h-12 w-full rounded-lg border border-black/15 px-5 py-3 text-sm font-black text-[#0D001A] transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#471AFF]"
                >
                  Вернуться ко входу
                </button>
              </div>
            </>
          ) : state.kind === "success" ? (
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check size={26} aria-hidden="true" />
              </span>
              <h1 className="mt-5 text-3xl font-black leading-tight">Готово</h1>
              <p className="mt-3 text-base leading-7 text-black/60">Вы подтвердили вход в KARIMOFF. Исходная страница завершит вход автоматически.</p>
              <button
                type="button"
                onClick={() => returnToKarimoff(state.returnUrl)}
                className="mt-7 min-h-12 w-full rounded-lg bg-[#0D001A] px-5 py-3 text-sm font-black text-white transition hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#471AFF]"
              >
                Вернуться в KARIMOFF
              </button>
            </>
          ) : state.kind === "expired" ? (
            <>
              <CircleAlert className="text-amber-600" size={36} aria-hidden="true" />
              <h1 className="mt-5 text-3xl font-black leading-tight">Время входа истекло</h1>
              <p className="mt-3 text-base leading-7 text-black/60">Вернитесь в KARIMOFF и начните вход через MAX заново.</p>
            </>
          ) : state.kind === "technical_error" ? (
            <>
              <CircleAlert className="text-red-600" size={36} aria-hidden="true" />
              <h1 className="mt-5 text-3xl font-black leading-tight">Не удалось завершить вход</h1>
              <p className="mt-3 text-base leading-7 text-black/60">{state.message}</p>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
