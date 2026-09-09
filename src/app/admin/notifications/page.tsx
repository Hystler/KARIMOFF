import { Activity, ArrowLeft, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import {
  getNotificationWorkspace, notificationStatuses, notificationStatusLabels
} from "@/lib/notifications/operations";
import { retryNotificationAction } from "./actions";

export const dynamic = "force-dynamic";

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow"
});
const dateLabel = (value: string | null) => value ? dateTime.format(new Date(value)) : "Нет данных";

export default async function NotificationsPage({ searchParams }: {
  searchParams: Promise<{ view?: string; result?: string }>;
}) {
  const params = await searchParams;
  const attentionOnly = params.view === "attention";
  const workspace = await getNotificationWorkspace(attentionOnly);
  const { configuration, counts, deliveries } = workspace;
  const enabled = configuration.enabled && !configuration.maintenance;
  const due = counts.reduce((sum, row) => sum + row.overdue, 0);
  const stale = counts.reduce((sum, row) => sum + row.stale, 0);
  const old = counts.reduce((sum, row) => sum + row.older_than_day, 0);
  const resultLabel = params.result === "queued" ? "Одна запись возвращена в очередь. Отправка выполняется фоновым обработчиком."
    : params.result === "not_allowed" ? "Повтор недоступен: состояние или условия доставки изменились."
      : params.result === "unavailable" ? "Не удалось подтвердить повтор. Обновите данные перед следующим действием." : null;

  return (
    <main className="admin-content admin-content-wide min-w-0">
      <header className="admin-heading flex-wrap gap-4">
        <div className="min-w-0">
          <Link href="/admin" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-karimoff-muted"><ArrowLeft size={16} /> Администрирование</Link>
          <h1>Уведомления</h1>
          <p>Статусы заказов: готов к выдаче и отменён</p>
        </div>
        <a href={attentionOnly ? "/admin/notifications?view=attention" : "/admin/notifications"}
          title="Обновить состояние" aria-label="Обновить состояние" className="admin-secondary-button h-11 w-11 shrink-0 !p-0">
          <RefreshCw size={18} />
        </a>
      </header>

      {resultLabel ? <p role="status" className={`admin-alert ${params.result === "queued" ? "admin-alert-success" : "admin-alert-error"}`}>{resultLabel}</p> : null}
      <section className="border-y border-karimoff-line py-5">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Activity size={20} /> Состояние доставки</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-karimoff-muted">Отправка</dt><dd className="mt-1 font-bold">{configuration.maintenance ? "Пауза обслуживания" : enabled ? "Включена" : "Выключена"}</dd></div>
          <div><dt className="text-karimoff-muted">Срок отправки наступил</dt><dd className="mt-1 font-bold">{workspace.error ? "Нет данных" : due}</dd></div>
          <div><dt className="text-karimoff-muted">Зависшие попытки</dt><dd className="mt-1 font-bold text-red-700">{workspace.error ? "Нет данных" : stale}</dd></div>
          <div><dt className="text-karimoff-muted">Ожидают более суток</dt><dd className="mt-1 font-bold">{workspace.error ? "Нет данных" : old}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-karimoff-muted">Срез: {dateLabel(workspace.checkedAt)} (Москва). Принято провайдером не означает прочитано.</p>
        {!enabled ? <p className="mt-3 text-sm text-red-700">Доставка остановлена. Новые события заказов могут продолжать накапливаться в очереди.</p> : null}
        {old > 0 ? <p className="mt-3 text-sm text-red-700">В очереди есть старые события. До включения доставки нужна проверка накопленных записей.</p> : null}
      </section>

      <section className="border-b border-karimoff-line py-5">
        <h2 className="text-lg font-bold">Конфигурация</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          {[["Telegram: токен задан", configuration.telegramConfigured], ["MAX: токен задан", configuration.maxConfigured], ["HTTPS-адрес кабинета корректен", configuration.appOriginValid]].map(([label, configured]) => (
            <div key={String(label)}><dt className="text-karimoff-muted">{label}</dt><dd className={`mt-1 font-bold ${configured ? "text-emerald-700" : "text-red-700"}`}>{configured ? "Да" : "Нет"}</dd></div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-karimoff-muted">Доступность API, действительность токенов и разрешение получателя не проверены.</p>
        <p className="mt-3 text-sm text-karimoff-muted">Telegram: для привязок без подтверждённого адресата Bot API нужен повторный обычный вход. До этого отправка заблокирована.</p>
      </section>

      {workspace.error ? (
        <p role="alert" className="admin-alert admin-alert-error mt-5">{workspace.error === "schema_missing"
          ? "Схема очереди недоступна. Требуется проверка установленной миграции."
          : "Очередь недоступна. Счётчики и статусы не получены."}</p>
      ) : (
        <>
          <section className="border-b border-karimoff-line py-5">
            <h2 className="text-lg font-bold">Очередь за всё время</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="admin-table min-w-[640px]">
                <thead><tr><th>Статус</th><th>Telegram</th><th>MAX</th></tr></thead>
                <tbody>{notificationStatuses.map((status) => <tr key={status}>
                  <th scope="row">{notificationStatusLabels[status]}</th>
                  {["telegram", "max"].map((provider) => <td key={provider}>{counts.find((row) => row.provider === provider && row.status === status)?.count ?? 0}</td>)}
                </tr>)}</tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm text-karimoff-muted">
              {["telegram", "max"].map((provider) => <p key={provider}>{provider === "telegram" ? "Telegram" : "MAX"}: последнее принятие {dateLabel(counts.find((row) => row.provider === provider && row.status === "sent")?.last_sent_at ?? null)}</p>)}
            </div>
          </section>
          <section className="border-b border-karimoff-line py-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-lg font-bold">Последние 50 записей</h2>
              <nav aria-label="Фильтр доставок" className="flex gap-4 text-sm">
                <Link href="/admin/notifications" aria-current={!attentionOnly ? "page" : undefined} className={!attentionOnly ? "border-b-2 border-black font-bold" : "text-karimoff-muted"}>Все</Link>
                <Link href="/admin/notifications?view=attention" aria-current={attentionOnly ? "page" : undefined} className={attentionOnly ? "border-b-2 border-black font-bold" : "text-karimoff-muted"}>Требуют внимания</Link>
              </nav>
            </div>
            {deliveries.length ? <div className="mt-3 overflow-x-auto">
              <table className="admin-table min-w-[900px]">
                <thead><tr><th>Канал / событие</th><th>Состояние</th><th>Попытки</th><th>Обновлено / срок</th><th>Повтор</th></tr></thead>
                <tbody>{deliveries.map((delivery) => <tr key={delivery.id}>
                  <td><strong>{delivery.provider === "telegram" ? "Telegram" : "MAX"}</strong><p>{delivery.event_type === "ready" ? "Готов к выдаче" : "Отменён"}</p></td>
                  <td><strong>{notificationStatusLabels[delivery.status]}</strong>{delivery.errorLabel ? <p className="mt-1 max-w-64 text-xs text-red-700">{delivery.errorLabel}</p> : null}</td>
                  <td>{delivery.attempts} / 8</td>
                  <td>{dateLabel(delivery.updated_at)}{["pending", "retry"].includes(delivery.status) ? <p className="mt-1 text-xs text-karimoff-muted">Не ранее {dateLabel(delivery.available_at)}</p> : null}</td>
                  <td>{delivery.can_retry ? <form action={retryNotificationAction} className="flex max-w-64 items-center gap-3">
                    <input type="hidden" name="delivery_id" value={delivery.id} />
                    <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="confirmed" value="yes" required className="mt-0.5" />Подтверждаю повтор одного уведомления</label>
                    <button type="submit" title="Вернуть одно уведомление в очередь" aria-label="Вернуть одно уведомление в очередь" className="admin-secondary-button h-11 w-11 shrink-0 !p-0"><RotateCcw size={17} /></button>
                  </form> : <span className="text-xs text-karimoff-muted">Недоступен</span>}</td>
                </tr>)}</tbody>
              </table>
            </div> : <p className="py-8 text-sm text-karimoff-muted">{attentionOnly ? "Записей, требующих внимания, нет." : "Очередь пока пуста."}</p>}
          </section>
        </>
      )}

      <section className="py-5">
        <h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck size={20} /> Предложения и рассылки</h2>
        <p className="mt-3 text-sm font-bold">Не активированы</p>
        <ul className="mt-3 grid gap-2 text-sm text-karimoff-muted">
          <li>Персональные предложения: отдельное согласие на рекламу, канал и персонализацию; отзыв согласия.</li>
          <li>Рассылки администратора: согласованная аудитория, предпросмотр, лимиты и явное подтверждение запуска.</li>
          <li>Push сотрудникам: отдельные получатели, роли и подписки. SMS не используется.</li>
        </ul>
      </section>
    </main>
  );
}
