import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logoutAction } from "../login/actions";

type CookieConsentRow = {
  accepted: boolean;
  categories: Record<string, unknown> | null;
  consent_id: string | null;
  created_at: string;
  customer_id: string | null;
  id: string;
  page_url: string | null;
};

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

export default async function AdminCookiesPage() {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const supabase = createSupabaseServerClient();
  let rows: CookieConsentRow[] = [];
  let count = 0;
  let error: string | null = null;
  let notConfigured = false;

  if (!supabase) {
    notConfigured = true;
  } else {
    const result = await supabase
      .from("cookie_consents")
      .select("id, created_at, consent_id, customer_id, accepted, categories, page_url", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(50);

    rows = (result.data ?? []) as CookieConsentRow[];
    count = result.count ?? rows.length;
    error = formatMissingTableError(result.error?.message, "cookie_consents", "supabase/cookie-consents.sql");
  }

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Cookie-согласия</h1>
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

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card">
            <p className="text-sm font-semibold text-karimoff-muted">Всего записей</p>
            <p className="mt-2 text-4xl font-black text-karimoff-orange">{count}</p>
          </div>
          <div className="rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:col-span-2">
            <p className="text-sm font-semibold text-karimoff-muted">Что хранится</p>
            <p className="mt-2 text-sm leading-6 text-karimoff-muted">
              Consent ID, категории согласия, дата, страница и customer_id, если пользователь был авторизован. IP не сохраняем.
            </p>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-karimoff-line bg-white shadow-card">
          {notConfigured ? (
            <div className="p-8 text-karimoff-muted">Supabase не подключён. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">{error}</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-karimoff-muted">Согласий пока нет.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                  <tr>
                    <th className="px-4 py-4 font-bold">Дата</th>
                    <th className="px-4 py-4 font-bold">Статус</th>
                    <th className="px-4 py-4 font-bold">Consent ID</th>
                    <th className="px-4 py-4 font-bold">Customer</th>
                    <th className="px-4 py-4 font-bold">Категории</th>
                    <th className="px-4 py-4 font-bold">Страница</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-karimoff-line last:border-b-0">
                      <td className="px-4 py-4 font-semibold">{formatDate(row.created_at)}</td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${row.accepted ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                          {row.accepted ? "Принято" : "Ограничено"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs text-karimoff-muted">{row.consent_id ?? "—"}</td>
                      <td className="px-4 py-4 text-xs text-karimoff-muted">{row.customer_id ?? "Гость"}</td>
                      <td className="px-4 py-4 text-xs text-karimoff-muted">{JSON.stringify(row.categories ?? {})}</td>
                      <td className="max-w-[260px] truncate px-4 py-4 text-xs text-karimoff-muted">{row.page_url ?? "—"}</td>
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
