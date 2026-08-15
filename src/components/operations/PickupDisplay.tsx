"use client";

import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { BellRing, Clock3, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AvatarPreview } from "@/components/avatar/AvatarPreview";
import { useOrderRealtime } from "@/hooks/useOrderRealtime";
import type { AvatarConfig } from "@/lib/avatar-schema";
import type { OrderLocation, PublicDisplayOrder } from "@/lib/order-flow/types";

const SOUND_STORAGE_KEY = "karimoff-display-sound-v1";
const fallbackColors = ["#D95706", "#B9382E", "#247A52", "#276B91", "#70549A", "#9A6A20"];

function seedNumber(value: string) {
  return Array.from(value).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "Г") + (parts[1]?.[0] || "")).toUpperCase();
}

function GuestAvatar({ order, large = false }: { order: PublicDisplayOrder; large?: boolean }) {
  if (order.publicAvatar) {
    return (
      <div className={`grid shrink-0 place-items-center overflow-hidden ${large ? "h-24 w-24 sm:h-28 sm:w-28" : "h-14 w-14"}`}>
        <div className={large ? "scale-90" : "scale-[0.48]"}>
          <AvatarPreview avatar={order.publicAvatar as AvatarConfig} size="sm" />
        </div>
      </div>
    );
  }
  const color = fallbackColors[seedNumber(order.publicAvatarSeed) % fallbackColors.length];
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full border border-white/15 font-black text-white ${large ? "h-20 w-20 text-2xl sm:h-24 sm:w-24 sm:text-3xl" : "h-14 w-14 text-lg"}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {initials(order.publicDisplayName)}
    </span>
  );
}

async function playReadySound() {
  const AudioContextClass = window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return false;
  const context = new AudioContextClass();
  try {
    await context.resume();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, context.currentTime + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.7);
    gain.connect(context.destination);
    [659.25, 783.99].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + index * 0.16);
      oscillator.stop(context.currentTime + 0.52 + index * 0.16);
    });
    window.setTimeout(() => void context.close(), 900);
    return true;
  } catch {
    void context.close();
    return false;
  }
}

function cookingGrid(count: number) {
  if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 9) return "grid-cols-2 xl:grid-cols-3";
  return "grid-cols-2 xl:grid-cols-4";
}

function readyGrid(count: number) {
  if (count === 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-2 2xl:grid-cols-3";
}

export function PickupDisplay({
  orders,
  location,
  initialCursor
}: {
  orders: PublicDisplayOrder[];
  location: OrderLocation;
  initialCursor: number;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const realtime = useOrderRealtime(location.id, () => router.refresh(), initialCursor);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundUnlocked, setSoundUnlocked] = useState(false);
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
    const timer = window.setTimeout(() => {
      setSoundEnabled(window.localStorage.getItem(SOUND_STORAGE_KEY) === "on");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const next = new Set(ready.map((order) => order.id));
    if (
      soundEnabled &&
      soundUnlocked &&
      previousReady.current &&
      ready.some((order) => !previousReady.current?.has(order.id))
    ) {
      void playReadySound();
    }
    previousReady.current = next;
  }, [ready, soundEnabled, soundUnlocked]);

  async function toggleSound() {
    if (soundEnabled && soundUnlocked) {
      setSoundEnabled(false);
      setSoundUnlocked(false);
      window.localStorage.setItem(SOUND_STORAGE_KEY, "off");
      return;
    }
    const unlocked = await playReadySound();
    setSoundEnabled(true);
    setSoundUnlocked(unlocked);
    window.localStorage.setItem(SOUND_STORAGE_KEY, "on");
  }

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#0D0D0F] text-white">
      <header className="flex min-h-[88px] items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-8 lg:px-12">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-[#FB670A]" aria-hidden="true" />
            <p className="truncate text-xs font-black uppercase text-white/55">KARIMOFF · {location.name}</p>
          </div>
          <h1 className="mt-1 truncate text-2xl font-black sm:text-3xl">Ваш заказ</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-xs font-black sm:inline-flex">
            {realtime === "online" ? <Wifi size={17} className="text-emerald-400" /> : <WifiOff size={17} className="text-amber-400" />}
            {realtime === "online" ? "Обновляется" : "Переподключение"}
          </span>
          <button
            type="button"
            onClick={() => void toggleSound()}
            className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3 font-bold transition hover:border-[#FB670A] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#FB670A]/30"
            aria-label={soundEnabled && soundUnlocked ? "Выключить звук" : "Разрешить звук"}
          >
            {soundEnabled ? <Volume2 size={21} /> : <VolumeX size={21} />}
            <span className="hidden text-xs sm:inline">{soundEnabled && soundUnlocked ? "Звук вкл." : soundEnabled ? "Разрешить звук" : "Звук выкл."}</span>
          </button>
        </div>
      </header>

      <LayoutGroup id="pickup-orders">
      <div className="grid min-h-[calc(100dvh-88px)] lg:grid-cols-[1.15fr_0.85fr]">
        <section className="border-b border-white/10 p-5 sm:p-8 lg:border-b-0 lg:border-r lg:p-10" aria-labelledby="display-cooking">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase text-white/35">Очередь</p>
              <h2 id="display-cooking" className="mt-2 flex items-center gap-3 text-2xl font-black uppercase sm:text-3xl">
                <Clock3 className="text-[#FB670A]" /> Готовится
              </h2>
            </div>
            <span className="grid h-11 min-w-11 place-items-center rounded-full border border-white/10 bg-white/[0.06] px-3 text-lg font-black">{cooking.length}</span>
          </div>
          {cooking.length ? (
            <motion.div layout className={`mt-7 grid gap-3 ${cookingGrid(cooking.length)}`}>
              <AnimatePresence mode="popLayout" initial={false}>
                {cooking.map((order) => (
                  <motion.article
                    layout
                    layoutId={`pickup-order-${order.id}`}
                    key={order.id}
                    initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                    transition={{ duration: reduceMotion ? 0 : 0.22 }}
                    className="flex min-h-[118px] min-w-0 items-center gap-4 rounded-lg border border-white/10 bg-white/[0.055] p-4"
                  >
                    <GuestAvatar order={order} />
                    <div className="min-w-0">
                      <strong className="block text-3xl font-black leading-none tabular-nums sm:text-4xl">{order.displayNumber}</strong>
                      <p className="mt-2 truncate text-base font-bold text-white/55">{order.publicDisplayName}</p>
                      {order.isTest ? <span className="mt-2 inline-block rounded-md bg-sky-400/15 px-2 py-1 text-[10px] font-black uppercase text-sky-300">Test</span> : null}
                    </div>
                  </motion.article>
                ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            <div className="mt-7 grid min-h-[220px] place-items-center rounded-lg border border-dashed border-white/15 px-5 text-center">
              <div><Clock3 className="mx-auto text-white/20" size={34} /><p className="mt-4 text-lg font-black text-white/45">Заказов в работе пока нет</p></div>
            </div>
          )}
        </section>

        <section className="relative bg-[#171719] p-5 sm:p-8 lg:p-10" aria-labelledby="display-ready">
          <div className="absolute inset-y-0 left-0 hidden w-1 bg-[#FB670A] lg:block" aria-hidden="true" />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase text-[#FF9A5C]">Можно забирать</p>
              <h2 id="display-ready" className="mt-2 flex items-center gap-3 text-3xl font-black uppercase sm:text-4xl">
                <BellRing className="text-[#FB670A]" /> Готово
              </h2>
            </div>
            <span className="grid h-12 min-w-12 place-items-center rounded-full bg-[#FB670A] px-3 text-xl font-black text-white">{ready.length}</span>
          </div>
          {ready.length ? (
            <motion.div layout className={`mt-7 grid gap-4 ${readyGrid(ready.length)}`}>
              <AnimatePresence mode="popLayout" initial={false}>
                {ready.map((order) => (
                  <motion.article
                    layout
                    layoutId={`pickup-order-${order.id}`}
                    key={order.id}
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.9, y: 18 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                    transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
                    className="relative flex min-h-[160px] min-w-0 items-center gap-4 overflow-hidden rounded-lg border border-[#FB670A]/40 bg-white p-4 text-[#121214] shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:p-5"
                  >
                    <span className="absolute inset-y-0 left-0 w-1.5 bg-[#FB670A]" aria-hidden="true" />
                    <GuestAvatar order={order} large />
                    <div className="min-w-0">
                      <strong className="block text-5xl font-black leading-none tabular-nums sm:text-6xl">{order.displayNumber}</strong>
                      <p className="mt-3 truncate text-lg font-black sm:text-xl">{order.publicDisplayName}</p>
                      {order.isTest ? <span className="mt-2 inline-block rounded-md bg-sky-100 px-2 py-1 text-[10px] font-black uppercase text-sky-800">Test</span> : null}
                    </div>
                  </motion.article>
                ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            <div className="mt-7 grid min-h-[280px] place-items-center rounded-lg border border-dashed border-white/15 px-5 text-center">
              <div><BellRing className="mx-auto text-[#FB670A]/45" size={38} /><p className="mt-4 text-xl font-black text-white/45">Готовые заказы появятся здесь</p></div>
            </div>
          )}
        </section>
      </div>
      </LayoutGroup>
    </main>
  );
}
