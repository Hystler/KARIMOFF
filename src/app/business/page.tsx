import { BusinessSection } from "@/components/BusinessSection";
import { LeadForm } from "@/components/LeadForm";

export default function BusinessPage() {
  return (
    <main className="pt-24">
      <BusinessSection />
      <section className="container-page pb-12">
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
