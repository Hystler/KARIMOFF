import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerOrdersLive } from "@/components/profile/CustomerOrdersLive";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { getCustomerOrdersForCustomer } from "@/lib/customer-orders";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Мои заказы | KARIMOFF",
  robots: { index: false, follow: false }
};

export default async function CustomerOrdersPage() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect(`/login?redirectTo=${encodeURIComponent("/profile/orders")}`);
  const result = await getCustomerOrdersForCustomer(customer.id);

  return (
    <main className="min-h-screen bg-karimoff-cream pt-24 text-karimoff-black sm:pt-28">
      <section className="container-page pb-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">KARIMOFF</p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">Мои заказы</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-karimoff-muted">Оплата, приготовление и готовность к выдаче обновляются здесь автоматически.</p>
          </div>
          <Link href="/profile" className="public-button-secondary px-5">В профиль</Link>
        </div>
        {result.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">Не удалось загрузить заказы. Попробуйте обновить страницу.</div>
        ) : (
          <CustomerOrdersLive initialOrders={result.orders} />
        )}
      </section>
    </main>
  );
}
