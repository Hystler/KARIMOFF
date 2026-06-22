"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { directions } from "@/data/directions";

export function Directions() {
  return (
    <section className="container-page py-10 sm:py-14" aria-label="Разделы сайта KARIMOFF">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {directions.map((item, index) => (
          <motion.article
            key={item.href}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.45, delay: index * 0.06 }}
            className="matte-card flex min-h-[220px] flex-col rounded-lg p-5 transition hover:-translate-y-1 hover:border-karimoff-orange/60 sm:min-h-[235px] sm:p-6"
          >
            <h3 className="text-2xl font-black text-karimoff-black">{item.title}</h3>
            <p className="mt-3 text-sm leading-6 text-karimoff-muted">{item.description}</p>
            <Link
              href={item.href}
              className="mt-auto inline-flex pt-5 text-sm font-bold text-karimoff-orange transition hover:text-karimoff-black"
            >
              {item.cta}
            </Link>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
