"use client";

import { useEffect, useRef, useState } from "react";

export type RealtimeState = "connecting" | "online" | "offline" | "fallback";

export function useOrderRealtime(locationId: string, refresh: () => void, initialCursor = 0) {
  const [state, setState] = useState<RealtimeState>("connecting");
  const stateRef = useRef<RealtimeState>("connecting");
  const refreshRef = useRef(refresh);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!locationId || typeof EventSource === "undefined") {
      const fallbackState = window.setTimeout(() => setState("fallback"), 0);
      return () => window.clearTimeout(fallbackState);
    }

    let source: EventSource | null = null;
    let fallback: ReturnType<typeof setInterval> | null = null;
    const scheduleRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => refreshRef.current(), 180);
    };
    const open = () => {
      const initial = navigator.onLine ? "connecting" : "offline";
      stateRef.current = initial;
      setState(initial);
      source = new EventSource(`/api/order-events?location=${encodeURIComponent(locationId)}&after=${initialCursor}`);
      source.addEventListener("ready", () => {
        stateRef.current = "online";
        setState("online");
      });
      source.addEventListener("order", scheduleRefresh);
      source.onerror = () => {
        const next = navigator.onLine ? "fallback" : "offline";
        stateRef.current = next;
        setState(next);
      };
    };
    const online = () => {
      source?.close();
      open();
      scheduleRefresh();
    };
    const offline = () => {
      stateRef.current = "offline";
      setState("offline");
    };

    open();
    fallback = setInterval(() => {
      if (stateRef.current !== "online") refreshRef.current();
    }, 30_000);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      source?.close();
      if (fallback) clearInterval(fallback);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [initialCursor, locationId]);

  return state;
}
