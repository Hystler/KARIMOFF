"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-white pt-20">
      <div className="container-page relative grid gap-7 py-6 sm:py-9 lg:min-h-[540px] lg:grid-cols-[minmax(0,0.95fr)_minmax(390px,0.82fr)] lg:items-center lg:gap-10 xl:gap-14">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: "easeOut" }}
          className="min-w-0 max-w-[760px]"
        >
          <div className="mb-4 flex items-center gap-3">
            <span className="h-px w-12 bg-karimoff-orange" />
            <span className="text-sm font-bold uppercase text-karimoff-orange">
              premium fast food
            </span>
          </div>
          <h1 className="text-balance font-heading text-[clamp(2.25rem,3.45vw,3.85rem)] font-black leading-[1.01] text-karimoff-black">
            Ресторанный вкус по цене обычного перекуса
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-karimoff-muted sm:text-lg">
            Первый фастфуд, приготовленный для вас с любовью.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link
              href="#brand"
              className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-karimoff-black/25 bg-white px-7 py-3.5 text-sm font-bold text-karimoff-black shadow-[0_12px_28px_rgba(18,18,20,0.06)] transition hover:-translate-y-0.5 hover:border-karimoff-orange hover:text-karimoff-orange"
            >
              О нас
            </Link>
            <Link
              href="#lead"
              className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-karimoff-orange bg-karimoff-orange px-7 py-3.5 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.22)] transition hover:-translate-y-0.5 hover:bg-karimoff-black hover:shadow-[0_16px_34px_rgba(18,18,20,0.16)]"
            >
              Заказать
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.75, delay: 0.1, ease: "easeOut" }}
          className="relative h-[245px] overflow-hidden rounded-[2rem] bg-karimoff-soft sm:h-[340px] lg:-mr-10 lg:h-[465px] lg:rounded-l-[3rem] lg:rounded-r-none xl:-mr-24"
        >
          <Image
            src="/assets/hero-karimoff.png"
            alt="KARIMOFF premium fast food"
            fill
            sizes="(min-width: 1280px) 48vw, (min-width: 1024px) 44vw, 100vw"
            priority
            className="scale-[1.03] object-cover object-center"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.52)_0%,rgba(255,255,255,0)_30%),linear-gradient(90deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0)_34%)] lg:bg-[linear-gradient(90deg,rgba(255,255,255,0.86)_0%,rgba(255,255,255,0.08)_36%,rgba(251,103,10,0.08)_100%)]" />
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-karimoff-orange via-karimoff-orange/60 to-transparent" />
        </motion.div>
      </div>
    </section>
  );
}
