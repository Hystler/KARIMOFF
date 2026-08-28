"use client";

import { CheckCircle2, Clock3, RotateCcw, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthDocumentLink } from "@/components/auth/AuthDocumentLink";

type PaymentState = "cancelled" | "failed" | "paid" | "pending" | "timeout";

type StatusPayload = {
  ok?: boolean;
  payment?: {
    orderNumber?: string;
    status?: string;
  };
};

function normalizeStatus(value: string | undefined): PaymentState {
  if (value === "paid" || value === "refunded" || value === "partially_refunded") return "paid";
  if (value === "cancelled" || value === "failed") return value;
  return "pending";
}

export function PaymentReturnStatus(props: {
  initialOrderNumber: string;
  initialStatus: string;
  paymentId: string;
}) {
  const [state, setState] = useState<PaymentState>(() => normalizeStatus(props.initialStatus));
  const [orderNumber, setOrderNumber] = useState(props.initialOrderNumber);
  const startedAt = useRef<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (state !== "paid") return undefined;
    const timeout = window.setTimeout(() => {
      window.dispatchEvent(new Event("karimoff-cart-clear-after-payment"));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [state]);

  const check = useCallback(async () => {
    if (inFlight.current || document.visibilityState === "hidden") return;
    inFlight.current = true;
    try {
      const request = await fetch(`/api/payments/${encodeURIComponent(props.paymentId)}/status`, {
        cache: "no-store",
        credentials: "same-origin"
      });
      const payload = await request.json().catch(() => null) as StatusPayload | null;
      if (!request.ok || !payload?.ok) return;
      const next = normalizeStatus(payload.payment?.status);
      setOrderNumber(payload.payment?.orderNumber || props.initialOrderNumber);
      setState(next);
    } finally {
      inFlight.current = false;
    }
  }, [props.initialOrderNumber, props.paymentId]);

  useEffect(() => {
    if (state !== "pending") return undefined;
    if (startedAt.current === null) startedAt.current = Date.now();
    const interval = window.setInterval(() => {
      if (startedAt.current !== null && Date.now() - startedAt.current > 120_000) {
        setState("timeout");
        return;
      }
      void check();
    }, 1_500);
    const resume = () => void check();
    const visible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", visible);
    void check();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [check, state]);

  if (state === "paid") {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" aria-hidden="true" />
        <h1 className="mt-5 text-3xl font-black">Оплата прошла</h1>
        <p className="mt-3 text-base leading-7 text-karimoff-muted">Заказ {orderNumber} принят и передан на кухню.</p>
        <AuthDocumentLink href="/profile" className="mt-7 inline-flex min-h-12 items-center justify-center rounded-full bg-karimoff-orange px-6 font-bold text-white">
          Перейти в профиль
        </AuthDocumentLink>
      </div>
    );
  }

  if (state === "cancelled" || state === "failed") {
    return (
      <div className="text-center">
        <XCircle className="mx-auto h-14 w-14 text-red-600" aria-hidden="true" />
        <h1 className="mt-5 text-3xl font-black">Оплата не прошла</h1>
        <p className="mt-3 text-base leading-7 text-karimoff-muted">Деньги не подтверждены. Можно вернуться к оформлению и начать новую попытку.</p>
        <Link href="/checkout" className="mt-7 inline-flex min-h-12 items-center justify-center rounded-full bg-karimoff-orange px-6 font-bold text-white">
          Попробовать снова
        </Link>
      </div>
    );
  }

  if (state === "timeout") {
    return (
      <div className="text-center">
        <RotateCcw className="mx-auto h-14 w-14 text-amber-600" aria-hidden="true" />
        <h1 className="mt-5 text-3xl font-black">Платёж ещё проверяется</h1>
        <p className="mt-3 text-base leading-7 text-karimoff-muted">Новый платёж автоматически не создаётся. Обновите статус этой попытки.</p>
        <button type="button" onClick={() => { startedAt.current = null; setState("pending"); }} className="mt-7 min-h-12 rounded-full bg-karimoff-orange px-6 font-bold text-white">
          Проверить ещё раз
        </button>
      </div>
    );
  }

  return (
    <div className="text-center" role="status" aria-live="polite">
      <Clock3 className="mx-auto h-14 w-14 animate-pulse text-karimoff-orange" aria-hidden="true" />
      <h1 className="mt-5 text-3xl font-black">Проверяем оплату…</h1>
      <p className="mt-3 text-base leading-7 text-karimoff-muted">Платёж обрабатывается. Это может занять несколько секунд.</p>
    </div>
  );
}
