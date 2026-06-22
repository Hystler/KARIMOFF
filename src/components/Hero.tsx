"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

type HeroProps = {
  title?: string | null;
  subtitle?: string | null;
};

export function Hero({ title, subtitle }: HeroProps) {
  const defaultTitle = "Первый фастфуд, приготовленный для вас с любовью";
  const defaultSubtitle = "Ресторанный вкус по цене обычного перекуса";
  const oldTitle = "Ресторанный вкус по цене обычного перекуса";
  const oldSubtitle = "Первый фастфуд, приготовленный для вас с любовью.";
  const oldSubtitleNoDot = "Первый фастфуд, приготовленный для вас с любовью";
  const heroTitle = !title || title === oldTitle ? defaultTitle : title;
  const heroSubtitle = !subtitle || subtitle === oldSubtitle || subtitle === oldSubtitleNoDot ? defaultSubtitle : subtitle;

  return (
    <section className="relative w-full overflow-hidden bg-karimoff-black pt-[68px] sm:pt-[74px]">
      <div className="absolute inset-0 bg-[url('/assets/hero/karimoff-hero-placeholder.svg')] bg-cover bg-center" aria-hidden="true" />
      <Image
        src="/assets/hero/rustam-package.jpg"
        alt="KARIMOFF на кухне"
        fill
        sizes="100vw"
        priority
        className="object-cover object-[54%_center] sm:object-[55%_center] lg:object-center"
      />
      <div className="hero-overlay absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.90)_0%,rgba(255,255,255,0.72)_36%,rgba(255,255,255,0.20)_64%,rgba(18,18,20,0.18)_100%),linear-gradient(180deg,rgba(18,18,20,0.10)_0%,rgba(18,18,20,0.32)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-karimoff-orange/45" />

      <div className="container-page relative flex min-h-[360px] items-center py-5 sm:min-h-[380px] sm:py-7 lg:min-h-[390px]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="hero-panel min-w-0 max-w-[560px] rounded-[1.35rem] border border-white/65 bg-white/70 p-5 shadow-[0_24px_70px_rgba(18,18,20,0.16)] backdrop-blur-md sm:p-6 lg:bg-white/64"
        >
          <h1 className="text-balance font-heading text-[clamp(1.9rem,4.1vw,3.6rem)] font-black leading-[0.96] text-karimoff-black">
            {heroTitle}
          </h1>
          <p className="mt-3 max-w-md text-[15px] font-semibold leading-7 text-karimoff-muted sm:text-base">
            {heroSubtitle}
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/about"
              className="hidden min-h-[50px] items-center justify-center rounded-full border border-karimoff-black/20 bg-white px-6 py-3 text-sm font-bold text-karimoff-black shadow-[0_12px_28px_rgba(18,18,20,0.08)] transition hover:-translate-y-0.5 hover:border-karimoff-orange hover:text-karimoff-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0 sm:inline-flex"
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
