"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { directions } from "@/data/directions";

export function Directions() {
  return (
    <section className="container-page py-16 sm:py-24">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-karimoff-orange">Сценарии</p>
        <h2 className="mt-3 text-balance text-4xl font-black text-karimoff-black sm:text-5xl">
          Выберите свой сценарий
        </h2>
      </div>
      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {directions.map((item, index) => (
          <motion.article
            key={item.href}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.45, delay: index * 0.06 }}
            className="matte-card rounded-lg p-6 transition hover:-translate-y-1 hover:border-karimoff-orange/60"
          >
            <h3 className="text-2xl font-black text-karimoff-black">{item.title}</h3>
            <p className="mt-4 min-h-24 text-sm leading-6 text-karimoff-muted">{item.description}</p>
            <Link
              href={item.href}
              className="mt-6 inline-flex text-sm font-bold text-karimoff-orange transition hover:text-karimoff-black"
            >
              {item.cta}
            </Link>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
