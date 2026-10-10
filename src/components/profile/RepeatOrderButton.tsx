"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import type { RepeatOrderResult } from "@/lib/repeat-order";

export function RepeatOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { replaceCart } = useCart();
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function repeatOrder() {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/customer/orders/${encodeURIComponent(orderId)}/repeat`, {
        cache: "no-store", credentials: "same-origin"
      });
      const payload = await response.json() as RepeatOrderResult & { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok || !Array.isArray(payload.items) || !Array.isArray(payload.issues)) {
        throw new Error(payload.error || "Не удалось повторить заказ. Попробуйте ещё раз.");
      }
      // Replace the mounted provider, not just storage: navigation preserves its live state.
      replaceCart(payload.items, payload.issues);
      router.push("/checkout");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось повторить заказ. Попробуйте ещё раз.");
    } finally {
      pending.current = false;
      setIsPending(false);
    }
  }

  return (
    <div className="max-w-xs">
      <button type="button" onClick={() => void repeatOrder()} disabled={isPending}
        className="public-button-primary min-h-10 px-4 py-2.5 text-xs">
        {isPending ? "Проверяем состав…" : "Повторить заказ"}
      </button>
      {error ? <p role="alert" className="mt-2 text-xs leading-5 text-red-700">{error}</p> : null}
    </div>
  );
}
