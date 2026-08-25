"use client";

import { Check, CircleAlert, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SocialProviderIcon } from "@/components/auth/SocialProviderIcon";

type MaxLoginButtonProps = {
  intent?: "login" | "link";
  onAttemptStart?: () => void;
  returnTo: string;
  suppressTransientError?: boolean;
  variant?: "full" | "compact";
};

type MaxAttempt = {
  attemptId: string;
  expiresInSeconds: number;
  launchUrl?: string;
};

type LoginState =
  | { kind: "preparing" }
  | { kind: "ready" }
  | { kind: "waiting" }
  | { kind: "completing" }
  | { kind: "success" }
  | { kind: "error"; code: string };

type BrowserTrigger = "focus" | "initial" | "interval" | "online" | "pageshow" | "resume" | "visibility";

const MAX_ATTEMPT_STORAGE_KEY = "karimoff_max_attempt";

function storeAttempt(attemptId: string) {
  try {
    window.sessionStorage.setItem(MAX_ATTEMPT_STORAGE_KEY, attemptId);
  } catch {
    // The authoritative browser binding remains in the secure cookie.
  }
}

function clearStoredAttempt() {
  try {
    window.sessionStorage.removeItem(MAX_ATTEMPT_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private browser contexts.
  }
}

function getErrorMessage(code: string) {
  if (code === "rate_limit") return "Слишком много попыток входа. Подождите немного и попробуйте снова.";
  if (code === "challenge_expired") return "Время подтверждения истекло. Начните вход ещё раз.";
  if (code === "identity_conflict") return "Этот аккаунт MAX уже связан с другим профилем.";
  if (code === "session_missing") return "Сессия не закрепилась. Нажмите, чтобы завершить вход.";
  if (code === "unavailable") return "Вход через MAX пока не настроен. Используйте другой способ входа.";
  return "Не удалось завершить вход через MAX. Попробуйте ещё раз.";
}

export function MaxLoginButton({
  intent = "login",
  onAttemptStart,
  returnTo,
  suppressTransientError = false,
  variant = "full"
}: MaxLoginButtonProps) {
  const router = useRouter();
  const mountedRef = useRef(true);
  const consumeRef = useRef(false);
  const statusRef = useRef(false);
  const expiresAtRef = useRef(0);
  const [attempt, setAttempt] = useState<MaxAttempt | null>(null);
  const [state, setState] = useState<LoginState>({ kind: "ready" });

  const createAttempt = useCallback(async () => {
    setState({ kind: "preparing" });
    const response = await fetch("/api/auth/social/max/start", {
      body: JSON.stringify({ intent, returnTo }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = await response.json().catch(() => null) as (MaxAttempt & { ok?: boolean; error?: string }) | null;
    if (!response.ok || !payload?.ok || !payload.attemptId || !payload.launchUrl) {
      throw new Error(payload?.error || "start_failed");
    }
    expiresAtRef.current = Date.now() + payload.expiresInSeconds * 1000;
    setAttempt(payload);
    storeAttempt(payload.attemptId);
    return payload;
  }, [intent, returnTo]);

  const beginLogin = useCallback(async () => {
    const maxWindow = window.open("about:blank", "_blank");
    if (maxWindow) {
      maxWindow.opener = null;
    }

    try {
      const nextAttempt = await createAttempt();
      if (maxWindow) {
        maxWindow.location.replace(nextAttempt.launchUrl ?? "https://max.ru");
        setState({ kind: "waiting" });
        return;
      }

      // Some mobile browsers block a new tab. Keep the signed launch link for
      // one explicit retry instead of navigating the KARIMOFF coordinator away.
      setState({ kind: "ready" });
    } catch (error) {
      maxWindow?.close();
      setState({ kind: "error", code: error instanceof Error ? error.message : "technical" });
    }
  }, [createAttempt]);

  const consumeInBrowser = useCallback(async (currentAttempt: MaxAttempt) => {
    if (consumeRef.current || document.visibilityState !== "visible") return;
    consumeRef.current = true;
    try {
      const response = await fetch("/api/auth/social/max/consume", {
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
        status?: "waiting" | "authenticated" | "linked" | "needs_phone";
      } | null;
      if (response.status === 202 && payload?.status === "waiting") {
        setState({ kind: "waiting" });
        return;
      }
      if (!response.ok || !payload?.ok || !payload.returnTo || !payload.status) {
        throw new Error(payload?.error || "technical");
      }

      const acknowledgement = await fetch("/api/auth/social/max/client-complete", {
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

      clearStoredAttempt();
      setState({ kind: "success" });
      const returnTo = acknowledged.returnTo ?? payload.returnTo;
      window.setTimeout(() => {
        router.replace(returnTo ?? "/profile");
        router.refresh();
      }, 700);
    } catch (error) {
      const code = error instanceof Error ? error.message : "technical";
      if (["browser_binding_mismatch", "challenge_replay"].includes(code)) {
        clearStoredAttempt();
      }
      setState({ kind: "error", code });
    } finally {
      consumeRef.current = false;
    }
  }, [router]);

  const checkStatus = useCallback(async (currentAttempt: MaxAttempt, reason: BrowserTrigger) => {
    if (statusRef.current || document.visibilityState !== "visible") return;
    statusRef.current = true;
    try {
      const query = new URLSearchParams({ attempt: currentAttempt.attemptId, reason });
      const response = await fetch(`/api/auth/social/max/status?${query}`, {
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
        clearStoredAttempt();
        setAttempt(null);
        setState({ kind: "error", code: "challenge_expired" });
        return;
      }
      if (payload.status === "failed") {
        setState({ kind: "error", code: "technical" });
        return;
      }

      setState({ kind: "completing" });
      if (document.visibilityState === "visible") {
        await consumeInBrowser(currentAttempt);
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "technical";
      if (["browser_binding_mismatch", "challenge_replay"].includes(code)) {
        clearStoredAttempt();
        setAttempt(null);
      }
      setState({ kind: "error", code });
    } finally {
      statusRef.current = false;
    }
  }, [consumeInBrowser]);

  useEffect(() => {
    mountedRef.current = true;
    const initialize = async () => {
      try {
        const response = await fetch("/api/auth/social/max/resume", {
          cache: "no-store",
          credentials: "same-origin",
          method: "POST"
        });
        const payload = await response.json().catch(() => null) as {
          challenge?: { attemptId: string; expiresInSeconds: number; status: string } | null;
          ok?: boolean;
        } | null;
        if (!mountedRef.current) return;
        if (response.ok && payload?.ok && payload.challenge) {
          const resumed: MaxAttempt = {
            attemptId: payload.challenge.attemptId,
            expiresInSeconds: payload.challenge.expiresInSeconds
          };
          expiresAtRef.current = Date.now() + resumed.expiresInSeconds * 1000;
          setAttempt(resumed);
          setState({ kind: payload.challenge.status === "completed" ? "completing" : "waiting" });
          void checkStatus(resumed, "resume");
          return;
        }
        setState({ kind: "ready" });
      } catch (error) {
        if (!mountedRef.current) return;
        setState({ kind: "error", code: error instanceof Error ? error.message : "technical" });
      }
    };
    void initialize();
    return () => {
      mountedRef.current = false;
    };
  }, [checkStatus]);

  useEffect(() => {
    if (!attempt || !["waiting", "completing"].includes(state.kind)) return;
    const poll = (reason: BrowserTrigger) => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() >= expiresAtRef.current) {
        clearStoredAttempt();
        setAttempt(null);
        setState({ kind: "error", code: "challenge_expired" });
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
  }, [attempt, checkStatus, state.kind]);

  function handleLaunch() {
    onAttemptStart?.();
    setState({ kind: "waiting" });
  }

  function handlePrimaryAction() {
    onAttemptStart?.();
    const resumableError = state.kind === "error"
      && attempt
      && !["browser_binding_mismatch", "challenge_expired", "challenge_replay", "identity_conflict"].includes(state.code);
    if (resumableError) {
      setState({ kind: "completing" });
      void checkStatus(attempt, "resume");
      return;
    }
    void beginLogin();
  }

  const visibleState: LoginState = suppressTransientError && state.kind === "error" ? { kind: "ready" } : state;
  const busy = ["preparing", "waiting", "completing"].includes(visibleState.kind);
  const label = visibleState.kind === "preparing"
    ? "Готовим вход через MAX…"
    : visibleState.kind === "waiting" || visibleState.kind === "completing"
      ? "Подтвердите вход в MAX"
      : visibleState.kind === "success"
        ? "Вход подтверждён"
        : visibleState.kind === "error" && attempt
          ? "Завершить вход через MAX"
          : intent === "link"
            ? "Подключить MAX"
            : "Войти через MAX";

  const content = (
    <>
      <span className={variant === "compact"
        ? "flex h-5 w-5 shrink-0 items-center justify-center"
        : "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25"}
      >
        {busy ? <LoaderCircle className="animate-spin" size={variant === "compact" ? 17 : 23} />
          : visibleState.kind === "success" ? <Check size={variant === "compact" ? 17 : 23} />
            : <SocialProviderIcon provider="max" className={variant === "compact" ? "h-5 w-5" : "h-6 w-6"} />
        }
      </span>
      {variant === "compact" ? label : (
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-black leading-5">{label}</span>
          <span className="mt-0.5 block text-xs font-semibold leading-5 text-white/80">
            {visibleState.kind === "waiting" || visibleState.kind === "completing" ? "После подтверждения вернитесь сюда" : "Быстрый вход через MAX"}
          </span>
        </span>
      )}
    </>
  );

  const buttonClass = variant === "compact"
    ? "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#6E1AFF] px-4 py-2.5 text-xs font-bold text-[#471AFF] transition hover:bg-[#471AFF] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#471AFF] disabled:cursor-wait disabled:opacity-65"
    : "flex min-h-[64px] w-full items-center gap-4 rounded-lg bg-[#471AFF] px-4 py-3 text-left text-white shadow-[0_14px_32px_rgba(71,26,255,0.22)] transition hover:-translate-y-0.5 hover:bg-[#5B2BFF] hover:shadow-[0_18px_38px_rgba(71,26,255,0.28)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#471AFF] active:translate-y-0 disabled:cursor-wait disabled:opacity-70";

  return (
    <div>
      {visibleState.kind === "ready" && attempt?.launchUrl ? (
        <a href={attempt.launchUrl} target="_blank" rel="noopener noreferrer" onClick={handleLaunch} className={buttonClass}>
          {content}
          {variant === "full" ? <ExternalLink className="shrink-0 text-white/75" size={18} /> : null}
        </a>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={handlePrimaryAction}
          className={buttonClass}
          aria-busy={busy}
        >
          {content}
          {visibleState.kind === "error" && variant === "full" ? <RefreshCw className="shrink-0" size={18} /> : null}
        </button>
      )}

      {variant === "full" ? (
        <div className="mt-3 rounded-lg border border-karimoff-line bg-karimoff-soft/70 p-4">
          <div className="flex items-start gap-3">
            {visibleState.kind === "error" ? <CircleAlert className="mt-0.5 shrink-0 text-red-600" size={19} /> : <ShieldCheck className="mt-0.5 shrink-0 text-[#471AFF]" size={19} />}
            <div className="text-[13px] leading-5 text-karimoff-muted" aria-live="polite">
              {visibleState.kind === "error" ? (
                <p className="font-semibold text-red-700">{getErrorMessage(visibleState.code)}</p>
              ) : visibleState.kind === "waiting" || visibleState.kind === "completing" ? (
                <>
                  <p className="font-bold text-karimoff-black">Подтвердите вход в MAX.</p>
                  <p className="mt-1">После подтверждения вернитесь сюда — вход завершится автоматически.</p>
                </>
              ) : visibleState.kind === "success" ? (
                <p className="font-bold text-emerald-700">Вы вошли через MAX. Возвращаем вас в KARIMOFF…</p>
              ) : (
                <>
                  <p className="font-bold text-karimoff-black">Вход выполняется через официальный Mini App MAX.</p>
                  <p className="mt-1">MAX откроется отдельно, а эта страница безопасно дождётся подтверждения.</p>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
