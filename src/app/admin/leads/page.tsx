import { redirect } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createDatabaseServerClient, type LeadRow } from "@/lib/database/server";
import { deleteLeadAction } from "./actions";

const interestLabels: Record<LeadRow["interest"], string> = {
  order: "Заказ",
  b2b: "B2B",
  career: "Работа",
  franchise: "Франшиза",
  other: "Другое"
};

const statusLabels: Record<LeadRow["status"], string> = {
  new: "Новая",
  in_progress: "В работе",
  closed: "Закрыта"
};

export const dynamic = "force-dynamic";

type AdminLeadsPageProps = {
  searchParams?: Promise<{
    deleted?: string;
    error?: string;
  }>;
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

async function getLeads() {
  const database = createDatabaseServerClient();

  if (!database) {
    return {
      leads: [] as LeadRow[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await database
    .from("leads")
    .select("id, created_at, name, phone, interest, comment, status, source")
    .order("created_at", { ascending: false });

  return {
    leads: (data ?? []) as LeadRow[],
    notConfigured: false,
    error: error?.message ?? null
  };
}

function getMessage(params: Awaited<NonNullable<AdminLeadsPageProps["searchParams"]>>) {
  if (params.deleted) {
    return { tone: "success", text: "Заявка удалена." };
  }

  if (params.error === "database") {
    return { tone: "error", text: "База данных не подключена. Заполните переменные окружения." };
  }

  if (params.error) {
    return { tone: "error", text: `Ошибка: ${params.error}` };
  }

  return null;
}

export default async function AdminLeadsPage({ searchParams }: AdminLeadsPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const params = searchParams ? await searchParams : {};
  const message = getMessage(params);
  const { leads, notConfigured, error } = await getLeads();

  return (
    <main className="admin-content leads-page">
      <div>
        <header className="admin-heading">
          <div>
            <p className="admin-eyebrow">Обращения</p>
            <h1>Заявки</h1>
            <p>Контакты по заказам, работе, сотрудничеству и франшизе.</p>
          </div>
        </header>

        {message ? (
          <div
            className={`mt-6 rounded-lg border px-5 py-4 text-sm font-semibold ${
              message.tone === "success"
                ? "border-karimoff-orange/25 bg-karimoff-orange/10 text-karimoff-orange"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <section className="admin-card mt-5 overflow-hidden border-t-[3px] !border-t-sky-600">
          {notConfigured ? (
            <div className="p-8 text-karimoff-muted">База данных не подключена. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">Не удалось загрузить заявки: {error}</div>
          ) : leads.length === 0 ? (
            <div className="p-8 text-karimoff-muted">Заявок пока нет.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="admin-table min-w-[860px]">
                <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                  <tr>
                    <th className="px-4 py-4 font-bold">Дата</th>
                    <th className="px-4 py-4 font-bold">Имя</th>
                    <th className="px-4 py-4 font-bold">Телефон</th>
                    <th className="px-4 py-4 font-bold">Интерес</th>
                    <th className="px-4 py-4 font-bold">Статус</th>
                    <th className="px-4 py-4 font-bold">Комментарий</th>
                    <th className="px-4 py-4 font-bold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id} className="border-b border-karimoff-line last:border-b-0">
                      <td className="px-4 py-4 text-karimoff-muted">{formatDate(lead.created_at)}</td>
                      <td className="px-4 py-4 font-semibold">{lead.name}</td>
                      <td className="px-4 py-4">{lead.phone}</td>
                      <td className="px-4 py-4">{interestLabels[lead.interest]}</td>
                      <td className="px-4 py-4">
                        <span className="inline-flex rounded-full bg-karimoff-orange/10 px-3 py-1 text-xs font-bold text-karimoff-orange">
                          {statusLabels[lead.status]}
                        </span>
                      </td>
                      <td className="max-w-xs px-4 py-4 text-karimoff-muted">{lead.comment || "—"}</td>
                      <td className="px-4 py-4">
                        <form action={deleteLeadAction}>
                          <input type="hidden" name="id" value={lead.id} />
                          <ConfirmSubmitButton
                            message={`Удалить заявку от ${lead.name}?`}
                            className="rounded-full border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                          >
                            Удалить
                          </ConfirmSubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
