import { redirect } from "next/navigation";
import { AuthDocumentLink } from "@/components/auth/AuthDocumentLink";
import { AvatarBuilder } from "@/components/avatar/AvatarBuilder";
import { getCustomerAvatar } from "@/lib/avatar";
import { getCurrentCustomer } from "@/lib/customer-auth";
import "../profile-theme.css";

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
  const { avatar, error } = await getCustomerAvatar(customer.id);
  const message = params.error === "database" ? "База данных не подключена." : params.error ? decodeURIComponent(params.error) : error;

  return (
    <main className="profile-theme pt-24 sm:pt-28">
      <section className="pb-16">
        <div className="container-page">
          <AuthDocumentLink href="/profile" className="profile-back profile-muted text-sm font-semibold transition">
            Профиль
          </AuthDocumentLink>
          <h1 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">Выбрать аватар</h1>
          <p className="profile-muted mt-3 max-w-2xl text-base leading-6">
            Десять панд, десять характеров. Выберите свою.
          </p>
        </div>

        <div className="container-page mt-6">
          <AvatarBuilder initialAvatar={avatar} error={message} />
        </div>
      </section>
    </main>
  );
}
