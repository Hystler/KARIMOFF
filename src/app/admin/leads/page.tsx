import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createSupabaseServerClient, type LeadRow } from "@/lib/supabase/server";
import { logoutAction } from "../login/actions";

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

export default async function AdminLeadsPage() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

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
