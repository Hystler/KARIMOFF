import { redirect } from "next/navigation";
import { AuthDocumentLink } from "@/components/auth/AuthDocumentLink";
import { AvatarBuilder } from "@/components/avatar/AvatarBuilder";
import { getAvatarAssets, getCustomerAvatar } from "@/lib/avatar";
import { getCurrentCustomer } from "@/lib/customer-auth";

type AvatarPageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

export default async function AvatarPage({ searchParams }: AvatarPageProps) {
  const customer = await getCurrentCustomer();

  if (!customer) {
    redirect("/login");
  }

  const params = searchParams ? await searchParams : {};
  const [{ avatar, error }, assetsResult] = await Promise.all([getCustomerAvatar(customer.id), getAvatarAssets()]);
  const message = params.error === "database" ? "База данных не подключена." : params.error ? decodeURIComponent(params.error) : error ?? assetsResult.error;

  return (
    <main className="bg-karimoff-cream pt-24 text-karimoff-black sm:pt-28">
      <section className="container-page pb-16">
        <AuthDocumentLink href="/profile" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
          Профиль
        </AuthDocumentLink>
        <h1 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">Создать 3D-персонажа</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-karimoff-muted">
          Выберите типаж, характер и образ. Персонажа можно вращать, приближать и сохранить в личном кабинете.
        </p>

        <div className="mt-8">
          <AvatarBuilder initialAvatar={avatar} options={assetsResult.options} error={message} />
        </div>
      </section>
    </main>
  );
}
