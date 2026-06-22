import Link from "next/link";
import { redirect } from "next/navigation";
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
  const message = params.error === "supabase" ? "Supabase не подключён." : params.error ? decodeURIComponent(params.error) : error ?? assetsResult.error;

  return (
    <main className="bg-karimoff-cream pt-28 text-karimoff-black">
      <section className="container-page pb-16">
        <Link href="/profile" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
          Профиль
        </Link>
        <h1 className="mt-3 text-4xl font-black leading-none sm:text-6xl">Настроить аватар</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-karimoff-muted">
          Соберите KARIMOFF-персонажа для личного кабинета. Слои сохраняются в профиле клиента.
        </p>

        <div className="mt-8">
          <AvatarBuilder initialAvatar={avatar} options={assetsResult.options} error={message} />
        </div>
      </section>
    </main>
  );
}
