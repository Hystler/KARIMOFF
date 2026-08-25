import {
  Cable,
  CheckCircle2,
  CircleAlert,
  Clock3,
  MonitorSmartphone,
  RefreshCw,
  Store
} from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentStaff } from "@/lib/admin-auth";
import { evotorRecoveryState } from "@/lib/integrations/evotor/recovery";
import { getEvotorAdminData } from "@/lib/integrations/evotor/repository";
import { checkEvotorAction, incrementalEvotorAction, syncEvotorAction } from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ error?: string; queued?: string }>;
};

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Moscow"
});

function formatDate(value: string | null) {
  return value ? dateTime.format(new Date(value)) : "Ещё не было";
}

const statusPresentation = {
  connected: {
    label: "Подключён",
    className: "bg-emerald-50 text-emerald-800"
  },
  degraded: {
    label: "Временная ошибка, повторим автоматически",
    className: "bg-amber-50 text-amber-800"
  },
  auth_error: {
    label: "Требуется переподключение",
    className: "bg-red-50 text-red-700"
  },
  disabled: {
    label: "Отключён",
    className: "bg-zinc-100 text-zinc-700"
  }
};

export default async function EvotorIntegrationPage({ searchParams }: PageProps) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!staff.legacy && !["owner", "admin", "manager"].includes(staff.role)) redirect("/admin");

  const params = searchParams ? await searchParams : {};
  const data = await getEvotorAdminData();
  const enabled = process.env.EVOTOR_ENABLED === "true";
  const callbackReady = Boolean(
    process.env.EVOTOR_WEBHOOK_AUTH_TOKEN && process.env.EVOTOR_TOKEN_ENCRYPTION_KEY
  );

  return (
    <main className="admin-content">
      <header className="admin-heading">
        <div className="max-w-3xl">
          <p className="admin-eyebrow">Интеграции</p>
          <h1>Эвотор</h1>
          <p>Подключения облака, магазины, кассы и безопасная синхронизация продаж.</p>
        </div>
        <Link href="/admin/integrations/evotor/reconciliation" className="admin-secondary-button">
          <Cable size={17} /> Сопоставление продаж
        </Link>
      </header>

      {params.queued ? (
        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-800">
          Задача поставлена в очередь. Результат появится после завершения синхронизации.
        </div>
      ) : null}
      {params.error ? (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
          Не удалось запустить операцию. Проверьте подключение или повторите позже.
        </div>
      ) : null}

      {!enabled || !callbackReady ? (
        <section className="mt-6 flex items-start gap-4 rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <CircleAlert className="mt-0.5 shrink-0" size={21} />
          <div>
            <h2 className="font-black">Интеграция выключена до настройки окружения</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6">
              Добавьте серверные секреты в Timeweb и включите EVOTOR_ENABLED. Токены в интерфейсе не отображаются.
            </p>
          </div>
        </section>
      ) : null}

      <section className="admin-metrics mt-6">
        <article><span>Подключений</span><strong>{data.connections.length}</strong></article>
        <article><span>Магазинов</span><strong>{data.stores.length}</strong></article>
        <article><span>Касс</span><strong>{data.devices.length}</strong></article>
        <article><span>Импортировано чеков</span><strong>{data.connections.reduce((sum, item) => sum + item.receipts_count, 0)}</strong></article>
      </section>

      <section className="mt-7 grid gap-5">
        {data.connections.map((connection) => {
          const stores = data.stores.filter((item) => item.connection_id === connection.id);
          const devices = data.devices.filter((item) => item.connection_id === connection.id);
          const recoveryState = evotorRecoveryState(connection.status);
          const presentation = statusPresentation[recoveryState];
          return (
            <article key={connection.id} className="admin-card p-5 sm:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${presentation.className}`}>
                      {recoveryState === "connected" ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
                      {presentation.label}
                    </span>
                    <span className="text-sm text-karimoff-muted">Установлено {formatDate(connection.installed_at)}</span>
                  </div>
                  <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <div><dt className="text-karimoff-muted">Последний sync</dt><dd className="mt-1 font-bold">{formatDate(connection.last_sync_at)}</dd></div>
                    <div><dt className="text-karimoff-muted">Успешный sync</dt><dd className="mt-1 font-bold">{formatDate(connection.last_success_at)}</dd></div>
                    <div><dt className="text-karimoff-muted">Cursor документов</dt><dd className="mt-1 font-bold">{formatDate(connection.last_cursor_at)}</dd></div>
                    <div><dt className="text-karimoff-muted">Последний запуск</dt><dd className="mt-1 font-bold">{formatDate(connection.last_sync_started_at)}</dd></div>
                    <div><dt className="text-karimoff-muted">Новых чеков</dt><dd className="mt-1 font-bold">{connection.last_imported_receipts}</dd></div>
                    <div><dt className="text-karimoff-muted">Изменённых чеков</dt><dd className="mt-1 font-bold">{connection.last_updated_receipts}</dd></div>
                    <div><dt className="text-karimoff-muted">Ошибок подряд</dt><dd className="mt-1 font-bold">{connection.consecutive_failures}</dd></div>
                    <div><dt className="text-karimoff-muted">Следующая попытка</dt><dd className="mt-1 font-bold">{recoveryState === "degraded" ? formatDate(connection.next_retry_at) : "Не требуется"}</dd></div>
                    <div><dt className="text-karimoff-muted">Последняя ошибка</dt><dd className="mt-1 font-bold">{formatDate(connection.last_error_at)}</dd></div>
                    <div><dt className="text-karimoff-muted">Всего чеков</dt><dd className="mt-1 font-bold">{connection.receipts_count}</dd></div>
                  </dl>
                  {connection.last_error_message ? (
                    <p className={`mt-4 rounded-md px-4 py-3 text-sm font-semibold ${
                      recoveryState === "degraded"
                        ? "bg-amber-50 text-amber-800"
                        : "bg-red-50 text-red-700"
                    }`}>
                      {connection.last_error_message}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <form action={checkEvotorAction}>
                    <input type="hidden" name="connection_id" value={connection.id} />
                    <button className="admin-secondary-button" type="submit" disabled={!enabled || !callbackReady}>
                      <Cable size={17} /> Проверить подключение
                    </button>
                  </form>
                  <form action={incrementalEvotorAction}>
                    <input type="hidden" name="connection_id" value={connection.id} />
                    <button className="admin-primary-button" type="submit" disabled={!enabled || !callbackReady}>
                      <RefreshCw size={17} /> Проверить новые продажи
                    </button>
                  </form>
                  <form action={syncEvotorAction}>
                    <input type="hidden" name="connection_id" value={connection.id} />
                    <button className="admin-secondary-button" type="submit" disabled={!enabled || !callbackReady}>
                      <RefreshCw size={17} /> Полная синхронизация
                    </button>
                  </form>
                </div>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <section className="rounded-lg border border-karimoff-line p-4">
                  <h3 className="flex items-center gap-2 font-black"><Store size={18} /> Магазины</h3>
                  <div className="mt-3 grid gap-2">
                    {stores.length ? stores.map((store) => (
                      <div key={store.id} className="rounded-md bg-karimoff-soft px-3 py-2.5 text-sm">
                        <strong>{store.name}</strong>
                        {store.address ? <p className="mt-1 text-karimoff-muted">{store.address}</p> : null}
                      </div>
                    )) : <p className="text-sm text-karimoff-muted">Магазины ещё не синхронизированы.</p>}
                  </div>
                </section>
                <section className="rounded-lg border border-karimoff-line p-4">
                  <h3 className="flex items-center gap-2 font-black"><MonitorSmartphone size={18} /> Кассы</h3>
                  <div className="mt-3 grid gap-2">
                    {devices.length ? devices.map((device) => (
                      <div key={device.id} className="flex items-center justify-between gap-3 rounded-md bg-karimoff-soft px-3 py-2.5 text-sm">
                        <span className="font-bold">{device.name || device.device_model || "Касса Эвотор"}</span>
                        <span className="text-xs font-bold text-karimoff-muted">{device.status || "Статус не указан"}</span>
                      </div>
                    )) : <p className="text-sm text-karimoff-muted">Кассы ещё не синхронизированы.</p>}
                  </div>
                </section>
              </div>
            </article>
          );
        })}
        {!data.connections.length ? (
          <section className="admin-card flex flex-col items-center px-6 py-12 text-center">
            <Clock3 className="text-karimoff-orange" size={30} />
            <h2 className="mt-4 text-xl font-black">Ожидаем токен Эвотор</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-karimoff-muted">
              После установки приложения Эвотор передаст токен на callback, и подключение появится здесь автоматически.
            </p>
          </section>
        ) : null}
      </section>

      {data.events.length ? (
        <section className="admin-card mt-7 overflow-hidden">
          <div className="border-b border-karimoff-line px-5 py-5 sm:px-6">
            <p className="admin-eyebrow">Журнал</p>
            <h2 className="mt-2 text-xl font-black">Последние синхронизации</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="admin-table min-w-[720px]">
              <thead><tr><th>Создана</th><th>Тип</th><th>Статус</th><th>Новые / обновлены</th><th>Попытки</th><th>Окно</th></tr></thead>
              <tbody>{data.events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDate(event.created_at)}</td>
                  <td className="font-bold">{event.sync_type}</td>
                  <td>{event.status}</td>
                  <td>{event.imported_count} / {event.updated_count}</td>
                  <td>{event.retry_count}</td>
                  <td className="text-karimoff-muted">{event.cursor_before || event.cursor_after ? `${formatDate(event.cursor_before)} → ${formatDate(event.cursor_after)}` : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
