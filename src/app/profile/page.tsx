import Link from "next/link";
import { redirect } from "next/navigation";
import { AvatarPreview } from "@/components/avatar/AvatarPreview";
import { RepeatOrderButton } from "@/components/profile/RepeatOrderButton";
import { getCustomerProfileData } from "@/lib/customer-data";
import { getConfiguredSocialProviders } from "@/lib/auth/social/config";
import { getUserIdentities } from "@/lib/auth/social/identity";
import { IdentityAvatar } from "@/components/auth/IdentityAvatar";
import { TelegramLoginButton } from "@/components/auth/TelegramLoginButton";
import { logoutCustomerAction, unlinkSocialIdentityAction, updateMarketingConsentAction } from "./actions";

export const dynamic = "force-dynamic";

const statusLabels = {
  new: "Новый",
  in_progress: "В работе",
  completed: "Выполнен",
  cancelled: "Отменён"
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(date));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
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
  const providerLabels = { phone: "Телефон", telegram: "Telegram", vk: "VK ID" } as const;

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
                    className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.20)] transition hover:-translate-y-0.5 hover:bg-[#D95405]"
                  >
                    Настроить аватар
                  </Link>
                  <Link
                    href="/menu"
                    className="rounded-full border border-karimoff-black/15 bg-white px-5 py-3 text-sm font-bold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
                  >
                    В меню
                  </Link>
                </div>
              </div>
            </div>
          </div>
          <form action={logoutCustomerAction}>
            <button
              type="submit"
              className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
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
            <p className="text-sm font-semibold text-karimoff-muted">Заказов</p>
            <p className="admin-number mt-3 text-3xl font-black text-karimoff-black">{orders.length}</p>
          </article>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
          <section className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-black">История заказов</h2>
              <Link href="/menu" className="text-sm font-bold text-karimoff-orange">
                В меню
              </Link>
            </div>
            {orders.length === 0 ? (
              <p className="mt-5 text-sm text-karimoff-muted">Заказов пока нет.</p>
            ) : (
              <div className="mt-5 grid gap-4">
                {orders.map((order) => (
                  <article key={order.id} className="rounded-lg border border-karimoff-line p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-black text-karimoff-black">{formatDate(order.created_at)}</p>
                        <p className="mt-1 text-xs font-semibold text-karimoff-orange">{statusLabels[order.status]}</p>
                        <p className="mt-1 text-xs font-semibold text-karimoff-muted">
                          {order.fulfillment_mode === "scheduled" && order.requested_at
                            ? `К ${formatDate(order.requested_at)}`
                            : "Как можно скорее"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-black text-karimoff-orange">{formatPrice(order.total)} ₽</p>
                        {order.items.length ? <RepeatOrderButton items={order.items} orderId={order.id} /> : null}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2">
                      {order.items.map((item) => (
                        <div key={item.id}>
                          <p className="text-sm leading-6 text-karimoff-muted">
                            {item.product_name} × {item.quantity} — {formatPrice(item.line_total)} ₽
                          </p>
                          {item.modifiers.map((modifier) => (
                            <p key={modifier.id} className="text-xs font-semibold text-karimoff-orange">
                              {modifier.modifier_type === "remove" ? "Без" : "Добавить"}: {modifier.ingredient_name}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

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
            {(["phone", "telegram", "vk"] as const).map((provider) => {
              const identity = identities.find((item) => item.provider === provider);
              const isConfigured = provider === "phone" || configuredProviders[provider];
              return (
                <article key={provider} className="flex flex-col gap-4 rounded-lg border border-karimoff-line p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <IdentityAvatar
                      identityId={identity?.id ?? provider}
                      label={provider === "phone" ? "+7" : provider === "telegram" ? "T" : "VK"}
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
                  ) : isConfigured ? (
                    <Link href={`/api/auth/social/${provider}/start?intent=link&returnTo=%2Fprofile`} className="min-h-10 rounded-full border border-karimoff-orange px-4 py-2.5 text-center text-xs font-bold text-karimoff-orange transition hover:bg-karimoff-orange hover:text-white">
                      Подключить
                    </Link>
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
              className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white transition hover:bg-[#D95405]"
            >
              Сохранить выбор
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
