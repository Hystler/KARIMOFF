"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { menuItems } from "@/data/menu";

export function PopularMenu() {
  return (
    <section id="menu" className="container-page pb-16 pt-4 sm:pb-20 sm:pt-8">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {menuItems.map((item, index) => (
          <motion.article
            key={item.id}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.45, delay: index * 0.06 }}
            className="matte-card group overflow-hidden rounded-lg"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-karimoff-soft">
              <Image
                src={item.image}
                alt={item.name}
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover transition duration-500 group-hover:scale-105"
              />
            </div>
            <div className="p-5">
              <h3 className="text-2xl font-black text-karimoff-black">{item.name}</h3>
              <p className="mt-2 min-h-20 text-sm leading-6 text-karimoff-muted">{item.description}</p>
              <div className="mt-5 flex items-center justify-between gap-4">
                <span className="text-xl font-black">{item.price} ₽</span>
                <Link
                  href="#lead"
                  className="rounded-full bg-karimoff-orange px-4 py-2 text-sm font-bold text-white transition hover:bg-karimoff-black"
                >
                  В заказ
                </Link>
              </div>
            </div>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
