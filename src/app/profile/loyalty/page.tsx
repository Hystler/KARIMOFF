import { Download, QrCode, RotateCcw, ShieldCheck, WalletCards } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { BrandWordmark } from "@/components/Logo";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { ensureLoyaltyAccount } from "@/lib/loyalty";
import { ensureLoyaltyCard } from "@/lib/loyalty-card";
import { getWalletConfiguration } from "@/lib/wallet/config";
import { joinLoyaltyAction, rotateLoyaltyCardAction } from "./actions";
import { getCurrentConsentState } from "@/lib/legal-consents";
import { LEGAL_VERSION } from "@/lib/legal";

export const dynamic = "force-dynamic";

function formatPoints(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

export default async function LoyaltyCardPage() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/login?redirectTo=/profile/loyalty");
  const consent = await getCurrentConsentState(customer.id, "loyalty_rules");
  if (consent?.granted !== true || consent.document_version !== LEGAL_VERSION) {
    return (
      <main className="min-h-dvh bg-karimoff-cream pt-24 text-karimoff-black sm:pt-28">
        <section className="container-page pb-16">
          <div className="mx-auto max-w-2xl rounded-lg border border-karimoff-line bg-white p-7 shadow-card sm:p-10">
            <p className="text-sm font-bold text-karimoff-orange-contrast">KARIMOFF Bonus</p>
            <h1 className="mt-3 text-3xl font-black">Присоединиться к программе лояльности</h1>
            <p className="mt-4 text-sm leading-6 text-karimoff-muted">Участие добровольное. Нажимая кнопку, вы принимаете действующую версию <Link href="/legal/loyalty" className="font-bold text-karimoff-orange-contrast">правил программы</Link>. Выбор сохранится в профиле и не будет повторно запрашиваться для каждого заказа.</p>
            <form action={joinLoyaltyAction} className="mt-6"><button className="public-button-primary px-6">Присоединиться и принять правила</button></form>
            <Link href="/profile" className="public-button-secondary mt-3 px-6">Назад в профиль</Link>
          </div>
        </section>
      </main>
    );
  }
  const [card, account] = await Promise.all([
    ensureLoyaltyCard(customer.id),
    ensureLoyaltyAccount(customer.id)
  ]);
  const wallet = getWalletConfiguration();

  return (
    <main className="min-h-dvh bg-karimoff-cream pt-24 text-karimoff-black sm:pt-28">
      <section className="container-page pb-16">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-base font-bold">Карта гостя</h1>
          <Link href="/profile" className="public-button-ghost min-h-11 px-3 text-sm">В профиль</Link>
        </div>

        <div className="mt-3 grid gap-4 sm:mt-5 sm:gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.75fr)]">
          <section className="overflow-hidden rounded-lg bg-karimoff-black text-white shadow-card">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6 sm:py-5">
              <div><BrandWordmark inverse size="sm" /><p className="mt-1 text-xs font-bold uppercase text-white/45">Карта гостя</p></div>
              <WalletCards className="text-karimoff-orange-contrast" size={30} />
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-[1fr_230px] sm:items-center sm:gap-6 sm:p-6">
              <div className="order-2 min-w-0 sm:order-1">
                <p className="text-sm font-bold text-white/55">Баланс</p>
                <p className="mt-2 font-heading text-5xl font-black tabular-nums">{formatPoints(account?.points_balance ?? 0)}</p>
                <p className="mt-2 text-sm font-bold text-karimoff-orange-contrast">баллов</p>
                <div className="mt-8">
                  <p className="text-xs font-bold uppercase text-white/40">Владелец</p>
                  <p className="mt-2 truncate text-lg font-black">{customer.name}</p>
                  <p className="mt-5 text-xs font-bold uppercase text-white/40">Номер карты</p>
                  <p className="mt-2 font-mono text-base font-bold tracking-[0.12em]">{card.publicCode}</p>
                </div>
              </div>
              <div data-loyalty-qr className="order-1 mx-auto w-full max-w-[256px] rounded-lg p-3 sm:order-2" style={{ backgroundColor: "#FFFFFF" }}>
                <Image src="/api/loyalty/card/qr" width={520} height={520} unoptimized alt="QR-код карты гостя KARIMOFF" className="aspect-square h-auto w-full" />
              </div>
            </div>
            <p className="px-4 pb-4 text-sm leading-5 text-white/70 sm:px-6 sm:pb-6">Покажите QR кассиру до оплаты.</p>
          </section>

          <aside className="space-y-5">
            <section className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
              <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-karimoff-soft text-karimoff-orange-contrast"><QrCode size={22} /></span><div><h2 className="text-xl font-black">Всегда под рукой</h2><p className="mt-2 text-sm leading-6 text-karimoff-muted">Откройте карту на телефоне или сохраните QR. На кассе достаточно показать код.</p></div></div>
              <a href="/api/loyalty/card/qr?download=1" download={`karimoff-${card.publicCode}.svg`} className="public-button-secondary mt-5 w-full px-5"><Download size={18} />Скачать QR</a>
            </section>

            {wallet.apple || wallet.google ? (
              <section className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
                <h2 className="text-xl font-black">Добавить в Wallet</h2>
                <p className="mt-2 text-sm leading-6 text-karimoff-muted">В Wallet сохраняются номер карты, баланс на момент добавления и тот же QR.</p>
                <div className="mt-5 grid gap-3">
                  {wallet.apple ? <a href="/api/loyalty/wallet/apple" className="public-button-primary w-full px-5"><WalletCards size={18} />Apple Wallet</a> : null}
                  {wallet.google ? <a href="/api/loyalty/wallet/google" className="public-button-secondary w-full px-5"><WalletCards size={18} />Google Wallet</a> : null}
                </div>
              </section>
            ) : (
              <section className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
                <h2 className="text-xl font-black">Wallet готовится</h2>
                <p className="mt-2 text-sm leading-6 text-karimoff-muted">QR уже работает. Кнопки Wallet появятся после подключения сертификата Apple и аккаунта издателя Google.</p>
              </section>
            )}

            <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
              <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0" size={21} /><p className="text-sm leading-6">QR не содержит телефон и не позволяет списать баллы. Если код попал не туда, перевыпустите карту.</p></div>
              <form action={rotateLoyaltyCardAction} className="mt-4">
                <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 text-sm font-black transition hover:border-emerald-500"><RotateCcw size={17} />Перевыпустить QR</button>
              </form>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
