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
  | { kind: "needs_contact" }
  | { kind: "requesting_contact" }
  | { kind: "success"; returnUrl: string }
  | { kind: "error"; message: string };

declare global {
  interface Window {
    WebApp?: {
      initData: string;
      openLink: (url: string) => void;
      requestContact: () => Promise<MaxContact>;
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
  if (code.includes("expired")) return "Время подтверждения истекло. Вернитесь в KARIMOFF и начните вход ещё раз.";
  if (code === "contact_phone_invalid") return "Не удалось подтвердить номер. Попробуйте ещё раз.";
  if (code === "rate_limit") return "Слишком много попыток. Подождите немного и попробуйте снова.";
  return "Не удалось подтвердить вход. Вернитесь в KARIMOFF и попробуйте ещё раз.";
}

export function MaxMiniApp({ configured }: { configured: boolean }) {
  const startedRef = useRef(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [state, setState] = useState<MiniAppState>(configured ? { kind: "loading" } : {
    kind: "error",
    message: "Вход через MAX пока не настроен."
  });

  const sendProof = useCallback(async (options?: { contact?: MaxContact; contactDenied?: boolean }) => {
    const initData = window.WebApp?.initData ?? "";
    const challenge = challengeFromInitData(initData);
    if (!initData || !challenge) {
      setState({ kind: "error", message: "Откройте этот экран через кнопку входа в KARIMOFF." });
      return;
    }
    setState(options?.contact ? { kind: "requesting_contact" } : { kind: "validating" });
    const response = await fetch("/api/auth/social/max/complete", {
      body: JSON.stringify({
        challenge,
        initData,
        ...(options?.contact ? { contact: options.contact } : {}),
        ...(options?.contactDenied ? { contactDenied: true } : {})
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
      setState({ kind: "needs_contact" });
      return;
    }
    if (!payload.returnUrl) throw new Error("technical");
    setState({ kind: "success", returnUrl: payload.returnUrl });
  }, []);

  useEffect(() => {
    if (!configured || !scriptReady || startedRef.current) return;
    startedRef.current = true;
    void sendProof().catch((error) => {
      setState({ kind: "error", message: userMessage(error instanceof Error ? error.message : "technical") });
    });
  }, [configured, scriptReady, sendProof]);

  async function requestPhone() {
    if (!window.WebApp?.requestContact) {
      setState({ kind: "error", message: "Обновите MAX или подтвердите номер через SMS в KARIMOFF." });
      return;
    }
    setState({ kind: "requesting_contact" });
    try {
      const contact = await window.WebApp.requestContact();
      await sendProof({ contact });
    } catch (error) {
      const code = (error as { error?: { code?: string } })?.error?.code ?? "";
      if (code.includes("user_refused_provide_phone_number")) {
        try {
          await sendProof({ contactDenied: true });
        } catch (completionError) {
          setState({ kind: "error", message: userMessage(completionError instanceof Error ? completionError.message : "technical") });
        }
        return;
      }
      setState({ kind: "error", message: "MAX не смог передать номер. Попробуйте ещё раз или продолжите по SMS в KARIMOFF." });
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
        onError={() => setState({ kind: "error", message: "Не удалось открыть вход. Обновите экран и попробуйте ещё раз." })}
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
          ) : state.kind === "needs_contact" ? (
            <>
              <ShieldCheck className="text-[#471AFF]" size={36} aria-hidden="true" />
              <h1 className="mt-5 text-3xl font-black leading-tight">Подтвердите номер</h1>
              <p className="mt-3 text-base leading-7 text-black/60">Номер нужен только для безопасной привязки к вашему профилю KARIMOFF.</p>
              <button
                type="button"
                onClick={() => void requestPhone()}
                className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#471AFF] px-5 py-3 text-sm font-black text-white transition hover:bg-[#5B2BFF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#471AFF]"
              >
                <Phone size={18} />
                Подтвердить номер
              </button>
              <p className="mt-4 text-center text-xs leading-5 text-black/50">Если вы откажетесь, завершить вход можно будет по SMS на сайте.</p>
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
          ) : state.kind === "error" ? (
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
