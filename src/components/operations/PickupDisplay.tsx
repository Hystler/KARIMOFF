"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Clock3, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { AvatarPreview } from "@/components/avatar/AvatarPreview";
import { useOrderRealtime } from "@/hooks/useOrderRealtime";
import type { AvatarConfig } from "@/lib/avatar-schema";
import type { OrderLocation, PublicDisplayOrder } from "@/lib/order-flow/types";

const fallbackColors = ["#FB670A", "#E53E3E", "#2F855A", "#2B6CB0", "#6B46C1", "#B7791F"];

function seedNumber(value: string) {
  return Array.from(value).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "Г") + (parts[1]?.[0] || "");
}

function GuestAvatar({ order, large = false }: { order: PublicDisplayOrder; large?: boolean }) {
  if (order.publicAvatar) {
    return (
      <div className={`${large ? "scale-[0.72] sm:scale-90" : "scale-[0.48]"} grid shrink-0 place-items-center overflow-hidden ${large ? "h-24 w-24 sm:h-28 sm:w-28" : "h-14 w-14"}`}>
        <AvatarPreview avatar={order.publicAvatar as AvatarConfig} size="sm" />
      </div>
    );
  }
  const color = fallbackColors[seedNumber(order.publicAvatarSeed) % fallbackColors.length];
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-black text-white shadow-lg ${large ? "h-20 w-20 text-2xl sm:h-24 sm:w-24 sm:text-3xl" : "h-14 w-14 text-lg"}`} style={{ backgroundColor: color }} aria-hidden="true">
      {initials(order.publicDisplayName).toUpperCase()}
    </span>
  );
}

function beep() {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(740, context.currentTime);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.34);
  oscillator.addEventListener("ended", () => void context.close());
}

export function PickupDisplay({ orders, location, initialCursor }: { orders: PublicDisplayOrder[]; location: OrderLocation; initialCursor: number }) {
  const router = useRouter();
  const realtime = useOrderRealtime(location.id, () => router.refresh(), initialCursor);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const previousReady = useRef<Set<string> | null>(null);
  const cooking = useMemo(
    () => orders.filter((order) => ["new", "accepted", "cooking"].includes(order.kitchenStatus)),
    [orders]
  );
  const ready = useMemo(
    () => orders.filter((order) => order.kitchenStatus === "ready"),
    [orders]
  );

  useEffect(() => {
    const next = new Set(ready.map((order) => order.id));
    if (soundEnabled && previousReady.current && ready.some((order) => !previousReady.current?.has(order.id))) beep();
    previousReady.current = next;
  }, [ready, soundEnabled]);

  return (
    <main className="min-h-dvh overflow-hidden bg-[#0C0C0D] text-white">
      <header className="flex min-h-[84px] items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-8 lg:px-12">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-[#FF914D]">KARIMOFF · {location.name}</p>
          <h1 className="mt-1 truncate text-2xl font-black sm:text-3xl">Заказы гостей</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden min-h-11 items-center gap-2 rounded-lg bg-white/[0.07] px-3 text-xs font-black sm:inline-flex">
            {realtime === "online" ? <Wifi size={17} className="text-emerald-400" /> : <WifiOff size={17} className="text-amber-400" />}
            {realtime === "online" ? "Онлайн" : "Переподключение"}
          </span>
          <button type="button" onClick={() => { setSoundEnabled((value) => !value); if (!soundEnabled) beep(); }} className="grid h-12 w-12 place-items-center rounded-lg border border-white/15 bg-white/[0.07]" aria-label={soundEnabled ? "Выключить звук" : "Включить звук"}>
            {soundEnabled ? <Volume2 size={21} /> : <VolumeX size={21} />}
          </button>
        </div>
      </header>

      <div className="grid min-h-[calc(100dvh-84px)] lg:grid-cols-[0.9fr_1.1fr]">
        <section className="border-b border-white/10 p-5 sm:p-8 lg:border-b-0 lg:border-r lg:p-10" aria-labelledby="display-cooking">
          <div className="flex items-center justify-between gap-4">
            <h2 id="display-cooking" className="flex items-center gap-3 text-xl font-black uppercase text-white/75 sm:text-2xl"><Clock3 className="text-[#FB670A]" /> Готовится</h2>
            <span className="grid h-10 min-w-10 place-items-center rounded-full bg-white/10 px-3 font-black">{cooking.length}</span>
          </div>
          {cooking.length ? (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
              {cooking.map((order) => (
                <article key={order.id} className="flex min-h-[116px] items-center gap-3 rounded-lg border border-white/10 bg-white/[0.06] p-3 sm:p-4">
                  <GuestAvatar order={order} />
                  <div className="min-w-0">
                    <strong className="block text-2xl font-black tabular-nums sm:text-3xl">{order.displayNumber}</strong>
                    <p className="mt-1 truncate text-sm font-bold text-white/55 sm:text-base">{order.publicDisplayName}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-6 grid min-h-[180px] place-items-center rounded-lg border border-dashed border-white/15 text-center text-white/35">Заказов в работе пока нет</div>
          )}
        </section>

        <section className="relative overflow-hidden bg-[#FB670A] p-5 text-[#121214] sm:p-8 lg:p-10" aria-labelledby="display-ready">
          <div className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, #fff 0 2px, transparent 2px)", backgroundSize: "26px 26px" }} />
          <div className="relative flex items-center justify-between gap-4">
            <h2 id="display-ready" className="flex items-center gap-3 text-2xl font-black uppercase sm:text-3xl"><BellRing /> Готово</h2>
            <span className="grid h-11 min-w-11 place-items-center rounded-full bg-[#121214] px-3 font-black text-white">{ready.length}</span>
          </div>
          {ready.length ? (
            <div className="relative mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {ready.map((order) => (
                <article key={order.id} className="flex min-h-[150px] items-center gap-4 rounded-lg border-2 border-black/15 bg-white p-4 shadow-[0_18px_0_rgba(18,18,20,0.12)] sm:p-5">
                  <GuestAvatar order={order} large />
                  <div className="min-w-0">
                    <strong className="block text-4xl font-black leading-none tabular-nums sm:text-5xl">{order.displayNumber}</strong>
                    <p className="mt-3 truncate text-lg font-black sm:text-xl">{order.publicDisplayName}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="relative mt-6 grid min-h-[240px] place-items-center rounded-lg border-2 border-dashed border-black/20 bg-white/20 text-center font-black text-black/45">Готовые заказы появятся здесь</div>
          )}
        </section>
      </div>
    </main>
  );
}
