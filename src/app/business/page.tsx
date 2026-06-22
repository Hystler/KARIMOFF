import { LeadForm } from "@/components/LeadForm";
import { PageHero } from "@/components/PageHero";
import { getSiteSettings } from "@/lib/settings";

export default async function BusinessPage() {
  const settings = await getSiteSettings();

  return (
    <main>
      <PageHero
        eyebrow="Для бизнеса"
        title="KARIMOFF для бизнеса"
        subtitle="Готовим форматы для корпоративных заказов, мероприятий, pop-up точек и партнёрских проектов. Подберём решение под площадку, поток гостей и задачу."
        ctaHref="#lead"
        ctaLabel="Обсудить сотрудничество"
        imageUrl={settings.business_hero_image_url}
        objectPosition="center"
      />
      <section className="container-page py-12">
        <div className="grid gap-4 md:grid-cols-3">
          {["Корпоративные заказы", "Мероприятия", "Pop-up точки"].map((item) => (
            <div key={item} className="matte-card rounded-lg p-6">
              <h2 className="text-2xl font-black text-karimoff-black">{item}</h2>
              <p className="mt-3 text-sm leading-6 text-karimoff-muted">
                Формат подбирается под площадку, поток гостей, тайминг и нужную скорость выдачи.
              </p>
            </div>
          ))}
        </div>
      </section>
      <LeadForm />
    </main>
  );
}
