"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative w-full overflow-hidden bg-karimoff-soft pt-[74px]">
      <div className="absolute inset-0 bg-[url('/assets/hero/karimoff-hero-placeholder.svg')] bg-cover bg-center" aria-hidden="true" />
      <Image
        src="/assets/hero-karimoff.png"
        alt="KARIMOFF premium fast food"
        fill
        sizes="100vw"
        priority
        className="object-cover object-[62%_center]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.96)_0%,rgba(255,255,255,0.88)_28%,rgba(255,255,255,0.46)_52%,rgba(255,255,255,0.02)_78%),linear-gradient(180deg,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0.18)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-karimoff-orange/45" />

      <div className="container-page relative flex min-h-[340px] items-center py-6 sm:min-h-[360px] sm:py-7 lg:min-h-[330px]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="min-w-0 max-w-[500px] rounded-[1.35rem] border border-white/70 bg-white/80 p-5 shadow-[0_24px_70px_rgba(18,18,20,0.12)] backdrop-blur-md sm:p-6 lg:bg-white/74"
        >
          <h1 className="text-balance font-heading text-[clamp(1.85rem,2.45vw,2.75rem)] font-black leading-[0.98] text-karimoff-black">
            Ресторанный вкус по цене обычного перекуса
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-7 text-karimoff-muted">
            Первый фастфуд, приготовленный для вас с любовью.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Link
              href="#brand"
              className="inline-flex min-h-[50px] items-center justify-center rounded-full border border-karimoff-black/20 bg-white px-6 py-3 text-sm font-bold text-karimoff-black shadow-[0_12px_28px_rgba(18,18,20,0.08)] transition hover:-translate-y-0.5 hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
            >
              О нас
            </Link>
            <Link
              href="#menu"
              className="inline-flex min-h-[50px] items-center justify-center rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-3 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.24)] transition hover:-translate-y-0.5 hover:bg-[#D95405] hover:shadow-[0_16px_34px_rgba(251,103,10,0.18)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
            >
              Заказать
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
