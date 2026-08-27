import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PaymentReturnStatus } from "@/components/payments/PaymentReturnStatus";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { getCustomerPaymentStatus } from "@/lib/payments/yookassa/repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Проверка оплаты | KARIMOFF",
  robots: { index: false, follow: false }
};

export default async function PaymentReturnPage({
  searchParams
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const params = await searchParams;
  const paymentId = String(params.payment || "");
  const returnPath = `/checkout/payment/return?payment=${encodeURIComponent(paymentId)}`;
  const customer = await getCurrentCustomer();
  if (!customer) redirect(`/login?redirectTo=${encodeURIComponent(returnPath)}`);

  const payment = /^[0-9a-f-]{36}$/i.test(paymentId)
    ? await getCustomerPaymentStatus(paymentId, customer.id)
    : null;

  return (
    <main className="min-h-screen bg-karimoff-cream px-4 pb-16 pt-28 text-karimoff-black">
      <section className="mx-auto max-w-xl rounded-lg border border-karimoff-line bg-white p-6 shadow-card sm:p-10">
        {payment ? (
          <PaymentReturnStatus
            paymentId={payment.paymentId}
            initialOrderNumber={payment.displayNumber}
            initialStatus={payment.paymentStatus}
          />
        ) : (
          <div className="text-center">
            <XCircleFallback />
            <h1 className="mt-5 text-3xl font-black">Платёж не найден</h1>
            <p className="mt-3 leading-7 text-karimoff-muted">Вернитесь в профиль и проверьте историю заказов.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function XCircleFallback() {
  return (
    <span aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-red-500 text-2xl font-black text-red-600">
      ×
    </span>
  );
}
