"use client";

import { motion } from "framer-motion";

type HeroProps = {
  imageUrl?: string | null;
  title?: string | null;
  subtitle?: string | null;
};

export function Hero({ imageUrl, title, subtitle }: HeroProps) {
  const defaultTitle = "Первый фастфуд, приготовленный для вас с любовью";
  const defaultSubtitle = "Ресторанный вкус по цене обычного перекуса";
  const oldTitle = "Ресторанный вкус по цене обычного перекуса";
  const oldSubtitle = "Первый фастфуд, приготовленный для вас с любовью.";
  const oldSubtitleNoDot = "Первый фастфуд, приготовленный для вас с любовью";
  const heroTitle = !title || title === oldTitle ? defaultTitle : title;
  const heroSubtitle = !subtitle || subtitle === oldSubtitle || subtitle === oldSubtitleNoDot ? defaultSubtitle : subtitle;

  return (
    <section className="relative mt-[68px] w-full overflow-hidden bg-karimoff-black sm:mt-[74px]">
      <div className="absolute inset-0 bg-[url('/assets/hero/karimoff-hero-placeholder.svg')] bg-cover bg-center" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl || "/assets/hero/rustam-package.jpg"}
        alt="KARIMOFF на кухне"
        className="absolute inset-0 h-full w-full object-cover object-[58%_center] sm:object-[55%_center] lg:object-center"
      />
      <div className="hero-overlay absolute inset-0 bg-[linear-gradient(90deg,rgba(18,18,20,0.78)_0%,rgba(18,18,20,0.56)_42%,rgba(18,18,20,0.24)_100%),linear-gradient(180deg,rgba(18,18,20,0.16)_0%,rgba(18,18,20,0.42)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-karimoff-orange/45" />

      <div className="container-page relative flex min-h-[340px] items-center py-7 sm:min-h-[370px] sm:py-9 lg:min-h-[390px]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="min-w-0 max-w-[560px]"
        >
          <h1 className="text-balance font-heading text-[clamp(1.85rem,3.8vw,3.25rem)] font-black leading-[0.98] text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.28)]">
            {heroTitle}
          </h1>
          <p className="mt-4 max-w-md text-[15px] font-bold leading-7 text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.28)] sm:text-base">
            {heroSubtitle}
          </p>
        </motion.div>
      </div>
    </section>
  );
}
