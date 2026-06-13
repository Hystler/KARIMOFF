import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createSupabaseServerClient, type LeadRow } from "@/lib/supabase/server";
import { logoutAction } from "../login/actions";
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
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      leads: [] as LeadRow[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase
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

  if (params.error === "supabase") {
    return { tone: "error", text: "Supabase не подключён. Заполните переменные окружения." };
  }

  if (params.error) {
    return { tone: "error", text: `Ошибка: ${decodeURIComponent(params.error)}` };
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
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Заявки</h1>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange"
            >
              Выйти
            </button>
          </form>
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

        <section className="mt-8 rounded-lg border border-karimoff-line bg-white shadow-card">
          {notConfigured ? (
            <div className="p-8 text-karimoff-muted">Supabase не подключён. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">Не удалось загрузить заявки: {error}</div>
          ) : leads.length === 0 ? (
            <div className="p-8 text-karimoff-muted">Заявок пока нет.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
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
