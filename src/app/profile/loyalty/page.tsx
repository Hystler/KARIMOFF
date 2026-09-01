import { Download, QrCode, RotateCcw, ShieldCheck, WalletCards } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { ensureLoyaltyAccount } from "@/lib/loyalty";
import { ensureLoyaltyCard } from "@/lib/loyalty-card";
import { getWalletConfiguration } from "@/lib/wallet/config";
import { rotateLoyaltyCardAction } from "./actions";

export const dynamic = "force-dynamic";

function formatPoints(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

export default async function LoyaltyCardPage() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/login?redirectTo=/profile/loyalty");
  const [card, account] = await Promise.all([
    ensureLoyaltyCard(customer.id),
    ensureLoyaltyAccount(customer.id)
  ]);
  const wallet = getWalletConfiguration();

  return (
    <main className="min-h-dvh bg-karimoff-cream pt-24 text-karimoff-black sm:pt-28">
      <section className="container-page pb-16">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold text-karimoff-orange">KARIMOFF Bonus</p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">Карта гостя</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-karimoff-muted">Покажите QR кассиру до оплаты. Заказ появится в профиле, а начисления попадут на эту карту.</p>
          </div>
          <Link href="/profile" className="public-button-secondary px-5">В профиль</Link>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.75fr)]">
          <section className="overflow-hidden rounded-lg bg-[#111114] text-white shadow-[0_24px_70px_rgba(17,17,20,0.2)]">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div><p className="text-xl font-black">KARIM<span className="text-karimoff-orange">O</span>FF</p><p className="mt-1 text-xs font-bold uppercase text-white/45">Карта гостя</p></div>
              <WalletCards className="text-karimoff-orange" size={30} />
            </div>
            <div className="grid gap-6 p-6 sm:grid-cols-[1fr_230px] sm:items-center">
              <div>
                <p className="text-sm font-bold text-white/55">Баланс</p>
                <p className="mt-2 text-5xl font-black tabular-nums">{formatPoints(account?.points_balance ?? 0)}</p>
                <p className="mt-2 text-sm font-bold text-karimoff-orange">баллов</p>
                <div className="mt-8">
                  <p className="text-xs font-bold uppercase text-white/40">Владелец</p>
                  <p className="mt-2 truncate text-lg font-black">{customer.name}</p>
                  <p className="mt-5 text-xs font-bold uppercase text-white/40">Номер карты</p>
                  <p className="mt-2 font-mono text-base font-bold tracking-[0.12em]">{card.publicCode}</p>
                </div>
              </div>
              <div className="rounded-lg bg-white p-3">
                <Image src="/api/loyalty/card/qr" width={520} height={520} unoptimized alt="QR-код карты гостя KARIMOFF" className="aspect-square h-auto w-full" />
              </div>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
              <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-karimoff-soft text-karimoff-orange"><QrCode size={22} /></span><div><h2 className="text-xl font-black">Всегда под рукой</h2><p className="mt-2 text-sm leading-6 text-karimoff-muted">Откройте карту на телефоне или сохраните QR. На кассе достаточно показать код.</p></div></div>
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
