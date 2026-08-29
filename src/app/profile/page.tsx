import Link from "next/link";
import { redirect } from "next/navigation";
import { AvatarPreview } from "@/components/avatar/AvatarPreview";
import { CustomerOrdersLive } from "@/components/profile/CustomerOrdersLive";
import { getCustomerProfileData } from "@/lib/customer-data";
import { getConfiguredSocialProviders } from "@/lib/auth/social/config";
import { getUserIdentities } from "@/lib/auth/social/identity";
import { IdentityAvatar } from "@/components/auth/IdentityAvatar";
import { TelegramLoginButton } from "@/components/auth/TelegramLoginButton";
import { MaxLoginButton } from "@/components/auth/MaxLoginButton";
import { logoutCustomerAction, unlinkSocialIdentityAction, updateMarketingConsentAction } from "./actions";

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
  const providerLabels = { phone: "Телефон", telegram: "Telegram", max: "MAX" } as const;
  const paidOrderCount = orders.filter((order) =>
    ["paid", "partially_refunded", "refunded"].includes(order.payment_status)
  ).length;

  return (
    <main className="bg-karimoff-cream pt-24 text-karimoff-black sm:pt-28">
      <section className="container-page pb-16">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-start">
          <div className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <AvatarPreview avatar={avatar} size="md" />
              <div>
                <p className="text-sm font-semibold text-karimoff-orange">Профиль</p>
                <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">{customer.name}</h1>
                <p className="mt-4 text-base font-semibold text-karimoff-muted">{customer.phone}</p>
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
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>
        ) : null}

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          <article className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <p className="text-sm font-semibold text-karimoff-muted">Баланс баллов</p>
            <p className="admin-number mt-3 text-4xl font-black text-karimoff-orange">{formatNumber(account?.points_balance ?? 0)}</p>
            <p className="mt-3 text-sm leading-6 text-karimoff-muted">
              Баллы пока можно копить. Списание добавим отдельной итерацией.
            </p>
          </article>
          <article className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <p className="text-sm font-semibold text-karimoff-muted">Всего начислено</p>
            <p className="admin-number mt-3 text-3xl font-black text-karimoff-black">{formatNumber(account?.total_earned ?? 0)}</p>
          </article>
          <article className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <p className="text-sm font-semibold text-karimoff-muted">Оплаченных заказов</p>
            <p className="admin-number mt-3 text-3xl font-black text-karimoff-black">{paidOrderCount}</p>
          </article>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
          <CustomerOrdersLive initialOrders={orders} preview />

          <section className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <h2 className="text-2xl font-black">Начисления</h2>
            {transactions.length === 0 ? (
              <p className="mt-5 text-sm text-karimoff-muted">Начислений пока нет.</p>
            ) : (
              <div className="mt-5 grid gap-3">
                {transactions.map((transaction) => (
                  <article key={transaction.id} className="rounded-lg border border-karimoff-line p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-black text-karimoff-black">{transaction.type}</p>
                        <p className="mt-1 text-xs text-karimoff-muted">{formatDate(transaction.created_at)}</p>
                      </div>
                      <p className="font-black text-karimoff-orange">{formatNumber(transaction.points)}</p>
                    </div>
                    {transaction.description ? (
                      <p className="mt-3 text-xs leading-5 text-karimoff-muted">{transaction.description}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="mt-8 max-w-3xl rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:p-6">
          <div>
            <p className="text-sm font-semibold text-karimoff-orange">Безопасность</p>
            <h2 className="mt-2 text-2xl font-black">Способы входа</h2>
            <p className="mt-2 text-sm leading-6 text-karimoff-muted">Привязки относятся к одному профилю. Токены сервисов не сохраняются.</p>
          </div>
          {params.identity === "linked" ? <p className="mt-4 text-sm font-semibold text-emerald-700">Способ входа подключён.</p> : null}
          {params.identity === "unlinked" ? <p className="mt-4 text-sm font-semibold text-emerald-700">Способ входа отключён.</p> : null}
          {params.identity_error ? <p className="mt-4 text-sm font-semibold text-red-600">Нельзя отключить последний доступный способ входа.</p> : null}
          <div className="mt-5 grid gap-3">
            {(["phone", "telegram", "max"] as const).map((provider) => {
              const identity = identities.find((item) => item.provider === provider);
              const isConfigured = provider === "phone" || configuredProviders[provider];
              return (
                <article key={provider} className="flex flex-col gap-4 rounded-lg border border-karimoff-line p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <IdentityAvatar
                      identityId={identity?.id ?? provider}
                      label={provider === "phone" ? "+7" : provider === "telegram" ? "T" : "MAX"}
                      hasImage={Boolean(identity?.avatarUrl)}
                    />
                    <div className="min-w-0">
                      <p className="font-black">{providerLabels[provider]}</p>
                      <p className="mt-1 truncate text-xs font-semibold text-karimoff-muted">
                        {identity
                          ? identity.username
                            ? `@${identity.username}`
                            : identity.displayName || identity.phone || "Подключено"
                          : isConfigured ? "Не подключено" : "Будет доступно после настройки"}
                      </p>
                    </div>
                  </div>
                  {identity ? (
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Подключено</span>
                      {provider !== "phone" ? (
                        <form action={unlinkSocialIdentityAction}>
                          <input type="hidden" name="provider" value={provider} />
                          <button type="submit" className="min-h-10 rounded-full border border-karimoff-line px-4 text-xs font-bold transition hover:border-red-300 hover:text-red-600">Отключить</button>
                        </form>
                      ) : null}
                    </div>
                  ) : provider === "phone" ? (
                    <span className="text-xs font-semibold text-karimoff-muted">Не подтверждён</span>
                  ) : provider === "telegram" && isConfigured ? (
                    <TelegramLoginButton intent="link" returnTo="/profile" variant="compact" />
                  ) : provider === "max" && isConfigured ? (
                    <MaxLoginButton intent="link" returnTo="/profile" variant="compact" />
                  ) : isConfigured ? (
                    <span className="text-xs font-semibold text-karimoff-muted">Не настроено</span>
                  ) : (
                    <span className="text-xs font-semibold text-karimoff-muted">Не настроено</span>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-8 max-w-3xl rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
          <h2 className="text-2xl font-black">Сообщения KARIMOFF</h2>
          <p className="mt-2 text-sm leading-6 text-karimoff-muted">
            Этот выбор не влияет на регистрацию, заказы и бонусы. Отказ фиксируется в журнале согласий.
          </p>
          <form action={updateMarketingConsentAction} className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-start gap-3 text-sm font-semibold text-karimoff-muted">
              <input
                type="checkbox"
                name="marketing_consent"
                defaultChecked={marketingConsent}
                className="mt-1 h-5 w-5 accent-karimoff-orange"
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
