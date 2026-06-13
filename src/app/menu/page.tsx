import Image from "next/image";
import Link from "next/link";
import { LeadForm } from "@/components/LeadForm";
import { menuItems } from "@/data/menu";

export default function MenuPage() {
  return (
    <main className="pt-28">
      <section className="container-page pb-16">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold text-karimoff-orange">
            Меню KARIMOFF
          </p>
          <h1 className="text-balance text-4xl font-black leading-[0.95] text-karimoff-black sm:text-6xl">
            Фирменные позиции без ресторанной паузы
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-karimoff-muted sm:text-lg">
            Первый набор меню собран вокруг сытных burger и street food позиций.
            Карточки уже готовы к будущему подключению корзины и доставки.
          </p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {menuItems.map((item) => (
            <article key={item.id} className="matte-card overflow-hidden rounded-lg">
              <div className="relative aspect-[4/3] bg-karimoff-soft">
                <Image
                  src={item.image}
                  alt={item.name}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="space-y-4 p-5">
                <div>
                  <h2 className="text-2xl font-black text-karimoff-black">{item.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-karimoff-muted">{item.description}</p>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xl font-black">{item.price} ₽</span>
                  <Link
                    href="#lead"
                    className="rounded-full bg-karimoff-orange px-4 py-2 text-sm font-bold text-white transition hover:bg-karimoff-black"
                  >
                    В заказ
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      <LeadForm />
    </main>
  );
}
