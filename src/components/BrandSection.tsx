"use client";

import { motion } from "framer-motion";

export function BrandSection() {
  return (
    <section id="brand" className="border-y border-karimoff-line bg-karimoff-cream py-16 sm:py-24">
      <div className="container-page">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.55 }}
          className="max-w-5xl"
        >
          <h2 className="text-balance text-4xl font-black leading-none text-karimoff-black sm:text-6xl">
            Fast food, собранный как ресторанный бренд
          </h2>
          <p className="mt-7 max-w-3xl text-lg leading-8 text-karimoff-muted sm:text-xl">
            KARIMOFF — это не просто точка с бургерами. Это продукт, визуал, скорость,
            кухня и система, которые можно масштабировать.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
