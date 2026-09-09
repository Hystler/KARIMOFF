import Link from "next/link";
import { redirect } from "next/navigation";
import { AvatarPreview } from "@/components/avatar/AvatarPreview";
import { CustomerOrdersLive } from "@/components/profile/CustomerOrdersLive";
import { getCustomerProfileData } from "@/lib/customer-data";
import { getConfiguredSocialProviders } from "@/lib/auth/social/config";
import { getUserIdentities } from "@/lib/auth/social/identity";
import { IdentityAvatar } from "@/components/auth/IdentityAvatar";
import { QrCode } from "lucide-react";
import { TelegramLoginButton } from "@/components/auth/TelegramLoginButton";
import { MaxLoginButton } from "@/components/auth/MaxLoginButton";
import { logoutCustomerAction, unlinkSocialIdentityAction, updateMarketingConsentAction } from "./actions";
import "./profile-theme.css";

export const dynamic = "force-dynamic";

function formatDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow"
  }).format(new Date(date));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

type ProfilePageProps = { searchParams?: Promise<{ identity?: string; identity_error?: string }> };

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const { customer, account, avatar, orders, transactions, marketingConsent, error } = await getCustomerProfileData();

  if (!customer) {
    redirect("/login");
  }
  const identities = await getUserIdentities(customer.id);
  const configuredProviders = getConfiguredSocialProviders();
  const params = searchParams ? await searchParams : {};
  const providerLabels = { telegram: "Telegram", max: "MAX" } as const;
  const paidOrderCount = orders.filter((order) =>
    ["paid", "partially_refunded", "refunded"].includes(order.payment_status)
  ).length;

  return (
    <main className="profile-theme pt-24 sm:pt-28">
      <section className="container-page pb-16">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="profile-surface profile-border rounded-lg border p-5 shadow-card sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <AvatarPreview avatar={avatar} size="md" />
              <div className="min-w-0">
                <p className="profile-accent text-sm font-semibold">Профиль</p>
                <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">{customer.name}</h1>
                <p className="profile-muted mt-4 text-base font-semibold">{customer.phone}</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href="/profile/avatar"
                    className="public-button-primary px-5"
                  >
                    Настроить аватар
                  </Link>
                  <Link
                    href="/menu"
                    className="public-button-secondary px-5"
                  >
                    В меню
                  </Link>
                  <Link
                    href="/profile/orders"
                    className="public-button-secondary px-5"
                  >
                    Мои заказы
                  </Link>
                </div>
              </div>
            </div>
          </div>
          <form action={logoutCustomerAction}>
            <button
              type="submit"
              className="public-button-secondary px-5"
            >
              Выйти
            </button>
          </form>
        </div>

        {error ? (
          <div className="profile-error mt-8 rounded-lg border p-5 text-sm font-semibold" role="alert">{error}</div>
        ) : null}

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <article className="profile-surface profile-border rounded-lg border p-5 shadow-card">
            <p className="profile-muted text-sm font-semibold">Баланс баллов</p>
            <p className="profile-accent admin-number mt-3 text-4xl font-black">{formatNumber(account?.points_balance ?? 0)}</p>
            <p className="profile-muted mt-3 text-sm leading-6">
              Баллы пока можно копить. Списание добавим отдельной итерацией.
            </p>
          </article>
          <article className="profile-surface profile-border rounded-lg border p-5 shadow-card">
            <p className="profile-muted text-sm font-semibold">Всего начислено</p>
            <p className="admin-number mt-3 text-3xl font-black">{formatNumber(account?.total_earned ?? 0)}</p>
          </article>
          <article className="profile-surface profile-border rounded-lg border p-5 shadow-card">
            <p className="profile-muted text-sm font-semibold">Оплаченных заказов</p>
            <p className="admin-number mt-3 text-3xl font-black">{paidOrderCount}</p>
          </article>
          <article className="profile-inverse profile-border rounded-lg border p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="profile-inverse-muted text-sm font-semibold">Карта гостя</p>
              <QrCode size={22} className="profile-accent shrink-0" />
            </div>
            <p className="mt-3 text-xl font-black">QR для кассы и Wallet</p>
            <Link href="/profile/loyalty" className="public-button-primary mt-5 w-full px-5">Открыть карту</Link>
          </article>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)]">
          <div className="profile-orders-preview min-w-0">
            <CustomerOrdersLive initialOrders={orders} preview />
          </div>

          <section className="profile-surface profile-border rounded-lg border p-5 shadow-card">
            <h2 className="text-2xl font-black">Начисления</h2>
            {transactions.length === 0 ? (
              <p className="profile-muted mt-5 text-sm">Начислений пока нет.</p>
            ) : (
              <div className="mt-5 grid gap-3">
                {transactions.map((transaction) => (
                  <article key={transaction.id} className="profile-border rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-black">{transaction.type}</p>
                        <p className="profile-muted mt-1 text-xs">{formatDate(transaction.created_at)}</p>
                      </div>
                      <p className="profile-accent font-black">{formatNumber(transaction.points)}</p>
                    </div>
                    {transaction.description ? (
                      <p className="profile-muted mt-3 text-xs leading-5">{transaction.description}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="profile-surface profile-border mt-8 max-w-3xl rounded-lg border p-5 shadow-card sm:p-6">
          <div>
            <p className="profile-accent text-sm font-semibold">Безопасность</p>
            <h2 className="mt-2 text-2xl font-black">Способы входа</h2>
            <p className="profile-muted mt-2 text-sm leading-6">Привязки относятся к одному профилю. Токены сервисов не сохраняются.</p>
          </div>
          {params.identity === "linked" ? <p className="profile-success mt-4 text-sm font-semibold">Способ входа подключён.</p> : null}
          {params.identity === "unlinked" ? <p className="profile-success mt-4 text-sm font-semibold">Способ входа отключён.</p> : null}
          {params.identity_error ? <p className="profile-danger mt-4 text-sm font-semibold">Нельзя отключить последний доступный способ входа.</p> : null}
          <div className="mt-5 grid gap-3">
            {(["telegram", "max"] as const).map((provider) => {
              const identity = identities.find((item) => item.provider === provider);
              const isConfigured = configuredProviders[provider];
              return (
                <article key={provider} className="profile-border flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <IdentityAvatar
                      identityId={identity?.id ?? provider}
                      label={provider === "telegram" ? "T" : "MAX"}
                      hasImage={Boolean(identity?.avatarUrl)}
                    />
                    <div className="min-w-0">
                      <p className="font-black">{providerLabels[provider]}</p>
                      <p className="profile-muted mt-1 truncate text-xs font-semibold">
                        {identity
                          ? identity.username
                            ? `@${identity.username}`
                            : identity.displayName || identity.phone || "Подключено"
                          : isConfigured ? "Не подключено" : "Будет доступно после настройки"}
                      </p>
                    </div>
                  </div>
                  {identity ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-3">
                      <span className="profile-success-badge rounded-full px-3 py-2 text-xs font-bold">Подключено</span>
                      {identities.some((item) => item.provider !== provider && (item.provider === "telegram" || item.provider === "max") && configuredProviders[item.provider]) ? (
                        <form action={unlinkSocialIdentityAction}>
                          <input type="hidden" name="provider" value={provider} />
                          <button type="submit" className="profile-unlink min-h-10 rounded-full border px-4 text-xs font-bold transition">Отключить</button>
                        </form>
                      ) : null}
                    </div>
                  ) : provider === "telegram" && isConfigured ? (
                    <div data-profile-provider="telegram" className="shrink-0">
                      <TelegramLoginButton intent="link" returnTo="/profile" variant="compact" />
                    </div>
                  ) : provider === "max" && isConfigured ? (
                    <div data-profile-provider="max" className="shrink-0">
                      <MaxLoginButton intent="link" returnTo="/profile" variant="compact" />
                    </div>
                  ) : isConfigured ? (
                    <span className="profile-muted text-xs font-semibold">Не настроено</span>
                  ) : (
                    <span className="profile-muted text-xs font-semibold">Не настроено</span>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="profile-surface profile-border mt-8 max-w-3xl rounded-lg border p-5 shadow-card">
          <h2 className="text-2xl font-black">Сообщения KARIMOFF</h2>
          <p className="profile-muted mt-2 text-sm leading-6">
            Этот выбор не влияет на регистрацию, заказы и бонусы. Отказ фиксируется в журнале согласий.
          </p>
          <form action={updateMarketingConsentAction} className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="profile-muted flex items-start gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                name="marketing_consent"
                defaultChecked={marketingConsent}
                className="mt-1 h-5 w-5 shrink-0 accent-karimoff-orange"
              />
              Хочу получать акции и предложения KARIMOFF
            </label>
            <button
              type="submit"
              className="public-button-primary px-5"
            >
              Сохранить выбор
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
