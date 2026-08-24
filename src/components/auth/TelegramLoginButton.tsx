"use client";

import { Check, CircleAlert, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SocialProviderIcon } from "@/components/auth/SocialProviderIcon";

const TELEGRAM_LIBRARY_URL = "https://oauth.telegram.org/js/telegram-login.js?5";

type TelegramAttempt = {
  attemptId: string;
  clientId: number;
  expiresInSeconds: number;
  nonce: string;
  returnTo: string;
};

type TelegramLibraryResult = {
  error?: string;
  id_token?: string;
  user?: unknown;
};

type TelegramLoginButtonProps = {
  intent?: "login" | "link";
  onAttemptStart?: () => void;
  returnTo: string;
  suppressTransientError?: boolean;
  variant?: "full" | "compact";
};

type LoginState =
  | { kind: "preparing" }
  | { kind: "ready" }
  | { kind: "waiting" }
  | { kind: "completing" }
  | { kind: "success" }
  | { kind: "error"; code: string };

declare global {
  interface Window {
    Telegram?: {
      Login?: {
        auth: (
          options: {
            client_id: number;
            lang: string;
            nonce: string;
            scope: Array<"phone" | "profile" | "write">;
          },
          callback: (result: TelegramLibraryResult) => void
        ) => Promise<void> | void;
        close: () => void;
      };
    };
  }
}

const attemptRequests = new Map<string, Promise<TelegramAttempt>>();

function getErrorMessage(code: string) {
  if (code === "cancelled" || code === "popup_closed") return "Вы отменили вход через Telegram.";
  if (code === "expired") return "Время подтверждения истекло. Попробуйте ещё раз.";
  if (code === "link_conflict") return "Этот Telegram уже связан с другим аккаунтом.";
  if (code === "rate_limit") return "Слишком много попыток входа. Подождите немного и попробуйте ещё раз.";
  if (code === "unavailable") return "Вход через Telegram сейчас недоступен. Используйте другой способ входа.";
  return "Не удалось завершить вход. Попробуйте ещё раз.";
}

function normalizeLibraryError(error: string | undefined) {
  if (!error) return "technical";
  if (["access_denied", "cancelled", "popup_closed", "user_cancelled"].includes(error)) return "cancelled";
  return "technical";
}

async function requestAttempt(key: string, intent: "login" | "link", returnTo: string) {
  const existing = attemptRequests.get(key);
  if (existing) return existing;

  const request = fetch("/api/auth/social/telegram/library/start", {
    body: JSON.stringify({ intent, returnTo }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST"
  }).then(async (response) => {
    const payload = await response.json().catch(() => null) as (TelegramAttempt & { ok?: boolean; error?: string }) | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "start_failed");
    }
    return payload;
  }).catch((error) => {
    attemptRequests.delete(key);
    throw error;
  });

  attemptRequests.set(key, request);
  return request;
}

export function TelegramLoginButton({
  intent = "login",
  onAttemptStart,
  returnTo,
  suppressTransientError = false,
  variant = "full"
}: TelegramLoginButtonProps) {
  const router = useRouter();
  const mountedRef = useRef(true);
  const processingRef = useRef(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [attempt, setAttempt] = useState<TelegramAttempt | null>(null);
  const [state, setState] = useState<LoginState>({ kind: "preparing" });
  const attemptKey = useMemo(() => `${intent}:${returnTo}`, [intent, returnTo]);

  const prepare = useCallback(async (preserveState = false) => {
    if (!mountedRef.current) return;
    if (!preserveState) setState({ kind: "preparing" });
    try {
      const nextAttempt = await requestAttempt(attemptKey, intent, returnTo);
      if (!mountedRef.current) return;
      setAttempt(nextAttempt);
      if (!preserveState) setState({ kind: "ready" });
    } catch (error) {
      if (!mountedRef.current) return;
      setState({ kind: "error", code: error instanceof Error ? error.message : "technical" });
    }
  }, [attemptKey, intent, returnTo]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const resetAttempt = useCallback(() => {
    attemptRequests.delete(attemptKey);
    setAttempt(null);
    processingRef.current = false;
  }, [attemptKey]);

  const finishOnServer = useCallback(async (idToken: string, currentAttempt: TelegramAttempt) => {
    setState({ kind: "completing" });
    try {
      const response = await fetch("/api/auth/social/telegram/library/complete", {
        body: JSON.stringify({ attemptId: currentAttempt.attemptId, idToken }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        ok?: boolean;
        returnTo?: string;
        status?: "authenticated" | "linked" | "needs_phone";
      } | null;
      if (!response.ok || !payload?.ok || !payload.returnTo || !payload.status) {
        throw new Error(payload?.error || "technical");
      }

      attemptRequests.delete(attemptKey);
      setState({ kind: "success" });

      if (payload.status !== "needs_phone") {
        void fetch("/api/auth/social/telegram/library/client-complete", {
          body: JSON.stringify({ attemptId: currentAttempt.attemptId }),
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          method: "POST"
        }).catch(() => undefined);
      }

      window.setTimeout(() => {
        router.replace(payload.returnTo ?? "/profile");
        router.refresh();
      }, 900);
    } catch (error) {
      const code = error instanceof Error ? error.message : "technical";
      resetAttempt();
      setState({ kind: "error", code });
      window.setTimeout(() => void prepare(true), 0);
    }
  }, [attemptKey, prepare, resetAttempt, router]);

  const handleLibraryResult = useCallback((result: TelegramLibraryResult) => {
    if (processingRef.current) return;
    window.Telegram?.Login?.close();

    if (result.error || !result.id_token || !attempt) {
      resetAttempt();
      setState({ kind: "error", code: normalizeLibraryError(result.error) });
      window.setTimeout(() => void prepare(true), 0);
      return;
    }

    processingRef.current = true;
    void finishOnServer(result.id_token, attempt);
  }, [attempt, finishOnServer, prepare, resetAttempt]);

  function handleClick() {
    onAttemptStart?.();
    if (state.kind === "error" && !attempt) {
      void prepare();
      return;
    }
    if (!attempt || !window.Telegram?.Login?.auth || ["waiting", "completing", "success"].includes(state.kind)) {
      return;
    }

    setState({ kind: "waiting" });
    try {
      const opening = window.Telegram.Login.auth({
        client_id: attempt.clientId,
        lang: "ru",
        nonce: attempt.nonce,
        scope: ["profile", "phone", "write"]
      }, handleLibraryResult);
      void Promise.resolve(opening).catch(() => {
        resetAttempt();
        setState({ kind: "error", code: "technical" });
        window.setTimeout(() => void prepare(true), 0);
      });
    } catch {
      resetAttempt();
      setState({ kind: "error", code: "technical" });
      window.setTimeout(() => void prepare(true), 0);
    }
  }

  const visibleState: LoginState = suppressTransientError && state.kind === "error" ? { kind: "ready" } : state;
  const busy = ["preparing", "waiting", "completing"].includes(visibleState.kind);
  const disabled = !scriptReady || busy || visibleState.kind === "success" || (!attempt && state.kind !== "error");
  const label = visibleState.kind === "waiting"
    ? "Подтвердите вход в Telegram"
    : visibleState.kind === "completing"
      ? "Завершаем вход…"
      : visibleState.kind === "success"
        ? "Вход подтверждён"
        : visibleState.kind === "preparing"
          ? "Готовим безопасный вход…"
          : intent === "link"
            ? "Подключить Telegram"
            : "Войти через Telegram";

  return (
    <>
      <Script
        id="telegram-login-library"
        src={TELEGRAM_LIBRARY_URL}
        strategy="afterInteractive"
        onReady={() => {
          setScriptReady(true);
          void prepare();
        }}
        onError={() => setState({ kind: "error", code: "unavailable" })}
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-busy={busy}
        className={variant === "compact"
          ? "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#229ED9] px-4 py-2.5 text-xs font-bold text-[#188CC4] transition hover:bg-[#229ED9] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229ED9] disabled:cursor-wait disabled:opacity-65"
          : "group flex min-h-[64px] w-full items-center gap-4 rounded-lg bg-[#229ED9] px-4 py-3 text-left text-white shadow-[0_14px_32px_rgba(34,158,217,0.24)] transition hover:-translate-y-0.5 hover:bg-[#188CC4] hover:shadow-[0_18px_38px_rgba(34,158,217,0.30)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#229ED9] active:translate-y-0 disabled:cursor-wait disabled:opacity-70"}
      >
        <span className={variant === "compact"
          ? "flex h-5 w-5 shrink-0 items-center justify-center"
          : "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25"}
        >
          {busy ? <LoaderCircle className="animate-spin" size={variant === "compact" ? 17 : 23} /> : visibleState.kind === "success" ? <Check size={variant === "compact" ? 17 : 23} /> : <SocialProviderIcon provider="telegram" className={variant === "compact" ? "h-5 w-5" : "h-6 w-6"} />}
        </span>
        {variant === "compact" ? label : (
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-black leading-5">{label}</span>
            <span className="mt-0.5 block text-xs font-semibold leading-5 text-white/80">
              {visibleState.kind === "waiting" ? "После подтверждения вернитесь сюда" : "Быстрый вход без ввода пароля"}
            </span>
          </span>
        )}
      </button>

      {variant === "full" ? (
        <div className="mt-4 rounded-lg border border-karimoff-line bg-karimoff-soft/70 p-4">
          <div className="flex items-start gap-3">
            {visibleState.kind === "error" ? <CircleAlert className="mt-0.5 shrink-0 text-red-600" size={19} /> : <ShieldCheck className="mt-0.5 shrink-0 text-[#188CC4]" size={19} />}
            <div className="text-[13px] leading-5 text-karimoff-muted" aria-live="polite">
              {visibleState.kind === "error" ? (
                <p className="font-semibold text-red-700">{getErrorMessage(visibleState.code)}</p>
              ) : visibleState.kind === "waiting" || visibleState.kind === "completing" ? (
                <>
                  <p className="font-bold text-karimoff-black">Подтвердите вход в Telegram.</p>
                  <p className="mt-1">После подтверждения вернитесь сюда — вход завершится автоматически.</p>
                </>
              ) : visibleState.kind === "success" ? (
                <p className="font-bold text-emerald-700">Вы вошли через Telegram. Возвращаем вас в KARIMOFF…</p>
              ) : (
                <>
                  <p className="font-bold text-karimoff-black">Вход выполняется через официальный Telegram.</p>
                  <p className="mt-1">Если вы разрешите доступ, Telegram передаст подтверждённый номер для вашего профиля.</p>
                  <p className="mt-1 flex items-center gap-1.5 font-semibold text-karimoff-black/75">
                    <LockKeyhole size={13} />
                    Мы не публикуем ничего от вашего имени.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
