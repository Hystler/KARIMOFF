"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-white pt-20">
      <div className="container-page relative grid min-h-[min(760px,calc(100svh-72px))] gap-8 py-8 sm:py-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(390px,0.8fr)] lg:items-center lg:gap-10 xl:gap-14">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: "easeOut" }}
          className="min-w-0 max-w-[820px]"
        >
          <h1 className="text-balance font-heading text-[clamp(2.55rem,4.1vw,4.35rem)] font-black leading-[0.97] text-karimoff-black">
            Ресторанный вкус по цене обычного перекуса
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-karimoff-muted sm:text-xl">
            Первый фастфуд, приготовленный для вас с любовью.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="#brand"
              className="inline-flex min-h-14 items-center justify-center rounded-full border border-karimoff-black/25 bg-white px-7 py-4 text-sm font-bold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
            >
              О нас
            </Link>
            <Link
              href="#lead"
              className="inline-flex min-h-14 items-center justify-center rounded-full bg-karimoff-orange px-7 py-4 text-sm font-bold text-white transition hover:bg-karimoff-black"
            >
              Заказать
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.75, delay: 0.1, ease: "easeOut" }}
          className="relative min-h-[280px] overflow-hidden rounded-[2rem] bg-karimoff-soft sm:min-h-[380px] lg:-mr-10 lg:min-h-[520px] lg:rounded-l-[3rem] lg:rounded-r-none xl:-mr-24"
        >
          <Image
            src="/assets/hero-karimoff.png"
            alt="KARIMOFF premium fast food"
            fill
            sizes="(min-width: 1280px) 48vw, (min-width: 1024px) 44vw, 100vw"
            priority
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.5)_0%,rgba(255,255,255,0)_28%),linear-gradient(90deg,rgba(255,255,255,0.7)_0%,rgba(255,255,255,0)_30%)] lg:bg-[linear-gradient(90deg,rgba(255,255,255,0.82)_0%,rgba(255,255,255,0)_34%)]" />
        </motion.div>
      </div>
    </section>
  );
}
