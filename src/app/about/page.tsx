import Image from "next/image";
import { BrandSection } from "@/components/BrandSection";

export default function AboutPage() {
  return (
    <main className="pt-24">
      <section className="container-page grid gap-10 pb-16 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <div>
          <p className="mb-4 text-sm font-semibold text-karimoff-orange">
            О бренде
          </p>
          <h1 className="text-balance text-4xl font-black leading-[0.95] text-karimoff-black sm:text-6xl">
            Premium fast food без лишнего шума
          </h1>
          <p className="mt-6 text-base leading-7 text-karimoff-muted sm:text-lg">
            KARIMOFF строится как масштабируемая fast food система: продукт, визуал,
            скорость, кухня и единый стандарт взаимодействия с гостем.
          </p>
        </div>
        <div className="relative min-h-[320px] overflow-hidden rounded-[2rem] bg-karimoff-soft">
          <Image
            src="/assets/hero-karimoff.png"
            alt="KARIMOFF food point"
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
            priority
          />
        </div>
      </section>
      <BrandSection />
    </main>
  );
}
