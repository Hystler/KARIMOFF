"use client";

import { Check, CircleAlert, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SocialProviderIcon } from "@/components/auth/SocialProviderIcon";

const TELEGRAM_LIBRARY_URL = "https://oauth.telegram.org/js/telegram-login.js?5";
const TELEGRAM_ATTEMPT_STORAGE_KEY = "karimoff_telegram_attempt";

type TelegramAttempt = {
  attemptId: string;
  clientId?: number;
  expiresInSeconds: number;
  nonce?: string;
  returnTo?: string;
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

type BrowserTrigger = "focus" | "initial" | "interval" | "online" | "pageshow" | "resume" | "visibility";

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

function storeAttempt(attemptId: string) {
  try {
    window.sessionStorage.setItem(TELEGRAM_ATTEMPT_STORAGE_KEY, attemptId);
  } catch {
    // The authoritative browser binding remains in the HttpOnly cookie.
  }
}

function readStoredAttempt() {
  try {
    return window.sessionStorage.getItem(TELEGRAM_ATTEMPT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function clearStoredAttempt() {
  try {
    window.sessionStorage.removeItem(TELEGRAM_ATTEMPT_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private browser contexts.
  }
}

function getErrorMessage(code: string) {
  if (code === "cancelled" || code === "popup_closed") return "Вы отменили вход через Telegram.";
  if (code === "expired" || code === "expired_state") return "Время подтверждения истекло. Попробуйте ещё раз.";
  if (code === "identity_conflict" || code === "link_conflict") return "Этот Telegram уже связан с другим аккаунтом.";
  if (code === "rate_limit") return "Слишком много попыток входа. Подождите немного и попробуйте ещё раз.";
  if (code === "session_missing") return "Вход подтверждён, но сессия не закрепилась. Нажмите, чтобы завершить вход.";
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
    if (!response.ok || !payload?.ok || !payload.attemptId || !payload.clientId || !payload.nonce) {
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
  const providerResultRef = useRef(false);
  const consumeRef = useRef(false);
  const statusRef = useRef(false);
  const expiresAtRef = useRef(0);
  const [scriptReady, setScriptReady] = useState(false);
  const [attempt, setAttempt] = useState<TelegramAttempt | null>(null);
  const [state, setState] = useState<LoginState>({ kind: "preparing" });
  const attemptKey = useMemo(() => `${intent}:${returnTo}`, [intent, returnTo]);

  const prepare = useCallback(async (preserveState = false) => {
    if (!mountedRef.current) return null;
    if (!preserveState) setState({ kind: "preparing" });
    try {
      const nextAttempt = await requestAttempt(attemptKey, intent, returnTo);
      if (!mountedRef.current) return null;
      expiresAtRef.current = Date.now() + nextAttempt.expiresInSeconds * 1000;
      setAttempt(nextAttempt);
      if (!preserveState) setState({ kind: "ready" });
      return nextAttempt;
    } catch (error) {
      if (!mountedRef.current) return null;
      setState({ kind: "error", code: error instanceof Error ? error.message : "technical" });
      return null;
    }
  }, [attemptKey, intent, returnTo]);

  const resetAttempt = useCallback((clearBrowserReference = true) => {
    attemptRequests.delete(attemptKey);
    if (clearBrowserReference) clearStoredAttempt();
    setAttempt(null);
    providerResultRef.current = false;
    consumeRef.current = false;
    statusRef.current = false;
  }, [attemptKey]);

  const consumeInActiveBrowser = useCallback(async (currentAttempt: TelegramAttempt) => {
    if (consumeRef.current || document.visibilityState !== "visible") return;
    consumeRef.current = true;
    setState({ kind: "completing" });
    try {
      const response = await fetch("/api/auth/social/telegram/consume", {
        body: JSON.stringify({ attemptId: currentAttempt.attemptId }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        ok?: boolean;
        returnTo?: string;
        status?: "authenticated" | "linked" | "needs_phone" | "waiting";
      } | null;
      if (response.status === 202 && payload?.status === "waiting") {
        setState({ kind: "waiting" });
        return;
      }
      if (!response.ok || !payload?.ok || !payload.returnTo || !payload.status) {
        throw new Error(payload?.error || "technical");
      }

      const acknowledgement = await fetch("/api/auth/social/telegram/client-complete", {
        body: JSON.stringify({ attemptId: currentAttempt.attemptId }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const acknowledged = await acknowledgement.json().catch(() => null) as {
        error?: string;
        ok?: boolean;
        returnTo?: string;
      } | null;
      if (!acknowledgement.ok || !acknowledged?.ok) {
        throw new Error(acknowledged?.error || "session_missing");
      }

      attemptRequests.delete(attemptKey);
      clearStoredAttempt();
      setState({ kind: "success" });
      const nextPath = acknowledged.returnTo ?? payload.returnTo;
      window.setTimeout(() => {
        router.replace(nextPath ?? "/profile");
        router.refresh();
      }, 700);
    } catch (error) {
      const code = error instanceof Error ? error.message : "technical";
      if (["browser_binding_mismatch", "expired_state", "state_replay"].includes(code)) {
        resetAttempt();
      }
      setState({ kind: "error", code });
    } finally {
      consumeRef.current = false;
    }
  }, [attemptKey, resetAttempt, router]);

  const checkStatus = useCallback(async (currentAttempt: TelegramAttempt, reason: BrowserTrigger) => {
    if (statusRef.current || document.visibilityState !== "visible") return;
    statusRef.current = true;
    try {
      const query = new URLSearchParams({ attempt: currentAttempt.attemptId, reason });
      const response = await fetch(`/api/auth/social/telegram/status?${query}`, {
        cache: "no-store",
        credentials: "same-origin",
        method: "GET"
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        ok?: boolean;
        status?: "completed" | "expired" | "failed" | "pending";
      } | null;
      if (!response.ok || !payload?.ok || !payload.status) {
        throw new Error(payload?.error || "technical");
      }
      if (payload.status === "pending") {
        setState({ kind: "waiting" });
        return;
      }
      if (payload.status === "expired") {
        resetAttempt();
        setState({ kind: "error", code: "expired" });
        return;
      }
      if (payload.status === "failed") {
        setState({ kind: "error", code: "technical" });
        return;
      }

      setState({ kind: "completing" });
      if (document.visibilityState === "visible") {
        await consumeInActiveBrowser(currentAttempt);
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "technical";
      if (["browser_binding_mismatch", "expired_state", "state_replay"].includes(code)) {
        resetAttempt();
      }
      setState({ kind: "error", code });
    } finally {
      statusRef.current = false;
    }
  }, [consumeInActiveBrowser, resetAttempt]);

  const finishProviderVerification = useCallback(async (idToken: string, currentAttempt: TelegramAttempt) => {
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
        status?: "completed";
      } | null;
      if (!response.ok || !payload?.ok || payload.status !== "completed") {
        throw new Error(payload?.error || "technical");
      }

      setState({ kind: document.visibilityState === "visible" ? "completing" : "waiting" });
      if (document.visibilityState === "visible") {
        await checkStatus(currentAttempt, "initial");
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "technical";
      resetAttempt();
      setState({ kind: "error", code });
      window.setTimeout(() => void prepare(true), 0);
    } finally {
      providerResultRef.current = false;
    }
  }, [checkStatus, prepare, resetAttempt]);

  const handleLibraryResult = useCallback((result: TelegramLibraryResult) => {
    if (providerResultRef.current) return;
    window.Telegram?.Login?.close();

    if (result.error || !result.id_token || !attempt) {
      resetAttempt();
      setState({ kind: "error", code: normalizeLibraryError(result.error) });
      window.setTimeout(() => void prepare(true), 0);
      return;
    }

    providerResultRef.current = true;
    void finishProviderVerification(result.id_token, attempt);
  }, [attempt, finishProviderVerification, prepare, resetAttempt]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!scriptReady) return;
    let cancelled = false;
    const initialize = async () => {
      const storedAttempt = readStoredAttempt();
      if (storedAttempt) {
        try {
          const response = await fetch("/api/auth/social/telegram/resume", {
            body: JSON.stringify({ attemptId: storedAttempt }),
            cache: "no-store",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            method: "POST"
          });
          const payload = await response.json().catch(() => null) as {
            attempt?: { attemptId: string; expiresInSeconds: number; status: "completed" | "failed" | "pending" } | null;
            ok?: boolean;
          } | null;
          if (!cancelled && response.ok && payload?.ok && payload.attempt) {
            const resumed: TelegramAttempt = {
              attemptId: payload.attempt.attemptId,
              expiresInSeconds: payload.attempt.expiresInSeconds
            };
            expiresAtRef.current = Date.now() + resumed.expiresInSeconds * 1000;
            setAttempt(resumed);
            setState({ kind: payload.attempt.status === "completed" ? "completing" : "waiting" });
            void checkStatus(resumed, "resume");
            return;
          }
        } catch {
          // A stale local reference is replaced with a fresh server attempt below.
        }
        clearStoredAttempt();
      }
      if (!cancelled) void prepare();
    };
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [checkStatus, prepare, scriptReady]);

  useEffect(() => {
    if (!attempt || !["waiting", "completing"].includes(state.kind)) return;
    const poll = (reason: BrowserTrigger) => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() >= expiresAtRef.current) {
        resetAttempt();
        setState({ kind: "error", code: "expired" });
        return;
      }
      void checkStatus(attempt, reason);
    };
    const interval = window.setInterval(() => poll("interval"), 2_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") poll("visibility");
    };
    const onPageShow = () => poll("pageshow");
    const onFocus = () => poll("focus");
    const onOnline = () => poll("online");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [attempt, checkStatus, resetAttempt, state.kind]);

  function handleClick() {
    onAttemptStart?.();
    if (state.kind === "error" && attempt) {
      setState({ kind: "completing" });
      void checkStatus(attempt, "resume");
      return;
    }
    if (!attempt || !attempt.clientId || !attempt.nonce || !window.Telegram?.Login?.auth) {
      void prepare();
      return;
    }
    if (["waiting", "completing", "success"].includes(state.kind)) return;

    storeAttempt(attempt.attemptId);
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
        onReady={() => setScriptReady(true)}
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
              {visibleState.kind === "waiting" || visibleState.kind === "completing" ? "После подтверждения вернитесь сюда" : "Быстрый вход без ввода пароля"}
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
              ) : visibleState.kind === "waiting" ? (
                <>
                  <p className="font-bold text-karimoff-black">Ждём подтверждение в Telegram.</p>
                  <p className="mt-1">После подтверждения вернитесь сюда — вход завершится автоматически.</p>
                </>
              ) : visibleState.kind === "completing" ? (
                <>
                  <p className="font-bold text-karimoff-black">Вход подтверждён.</p>
                  <p className="mt-1">Завершаем вход…</p>
                </>
              ) : visibleState.kind === "success" ? (
                <p className="font-bold text-emerald-700">Готово. Вы вошли через Telegram.</p>
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
