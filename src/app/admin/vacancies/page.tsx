import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { formatVacancySalary, getAdminVacancies } from "@/lib/vacancies";
import { logoutAction } from "../login/actions";
import { deleteVacancyAction, toggleVacancyActiveAction } from "./actions";

type AdminVacanciesPageProps = {
  searchParams?: Promise<{ deleted?: string; error?: string; saved?: string }>;
};

export const dynamic = "force-dynamic";

function getMessage(params: Awaited<NonNullable<AdminVacanciesPageProps["searchParams"]>>) {
  if (params.saved) {
    return { tone: "success", text: "Вакансия сохранена." };
  }

  if (params.deleted) {
    return { tone: "success", text: "Вакансия удалена." };
  }

  if (params.error === "supabase") {
    return { tone: "error", text: "Supabase не подключён. Заполните переменные окружения." };
  }

  if (params.error) {
    return { tone: "error", text: "Не удалось выполнить действие. Проверьте SQL supabase/vacancies.sql." };
  }

  return null;
}

export default async function AdminVacanciesPage({ searchParams }: AdminVacanciesPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const params = searchParams ? await searchParams : {};
  const message = getMessage(params);
  const { vacancies, notConfigured, error } = await getAdminVacancies();

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-7xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Вакансии</h1>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/admin/vacancies/new" className="rounded-full border border-karimoff-orange bg-karimoff-orange px-5 py-3 text-sm font-bold text-white shadow-[0_14px_30px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405]">
              Создать вакансию
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange">
                Выйти
              </button>
            </form>
          </div>
        </header>

        {message ? (
          <div className={`mt-6 rounded-lg border px-5 py-4 text-sm font-semibold ${message.tone === "success" ? "border-karimoff-orange/25 bg-karimoff-orange/10 text-karimoff-orange" : "border-red-200 bg-red-50 text-red-700"}`}>
            {message.text}
          </div>
        ) : null}

        <section className="mt-8 rounded-[1.25rem] border border-karimoff-line bg-white shadow-[0_24px_70px_rgba(18,18,20,0.08)]">
          {notConfigured ? (
            <div className="p-8 text-karimoff-muted">Supabase не подключён. Заполните переменные окружения.</div>
          ) : error ? (
            <div className="p-8 text-red-600">{error}</div>
          ) : vacancies.length === 0 ? (
            <div className="p-8 text-karimoff-muted">Вакансий пока нет. Создайте первую вакансию.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
                <thead className="border-b border-karimoff-line bg-karimoff-soft text-xs text-karimoff-muted">
                  <tr>
                    <th className="px-4 py-4 font-bold">Вакансия</th>
                    <th className="px-4 py-4 font-bold">Отдел</th>
                    <th className="px-4 py-4 font-bold">Формат</th>
                    <th className="px-4 py-4 font-bold">Оплата</th>
                    <th className="px-4 py-4 font-bold">График</th>
                    <th className="px-4 py-4 font-bold">Статус</th>
                    <th className="px-4 py-4 font-bold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {vacancies.map((vacancy) => (
                    <tr key={vacancy.id} className="border-b border-karimoff-line last:border-b-0">
                      <td className="px-4 py-4">
                        <p className="font-semibold">{vacancy.title}</p>
                        <p className="mt-1 text-xs text-karimoff-muted">{vacancy.slug} · #{vacancy.sort_order}</p>
                      </td>
                      <td className="px-4 py-4">{vacancy.department ?? "—"}</td>
                      <td className="px-4 py-4">{vacancy.employment_type ?? "—"}</td>
                      <td className="px-4 py-4 font-black text-karimoff-orange">{formatVacancySalary(vacancy) ?? "—"}</td>
                      <td className="px-4 py-4">{vacancy.schedule ?? "—"}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${vacancy.is_active ? "bg-karimoff-orange/10 text-karimoff-orange" : "bg-karimoff-black/5 text-karimoff-muted"}`}>
                          {vacancy.is_active ? "На сайте" : "Скрыта"}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <Link href={`/admin/vacancies/${vacancy.id}/edit`} className="rounded-full border border-karimoff-line px-3 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange">
                            Редактировать
                          </Link>
                          <form action={toggleVacancyActiveAction}>
                            <input type="hidden" name="id" value={vacancy.id} />
                            <input type="hidden" name="next_active" value={String(!vacancy.is_active)} />
                            <button type="submit" className="rounded-full border border-karimoff-line px-3 py-2 text-xs font-bold transition hover:border-karimoff-orange hover:text-karimoff-orange">
                              {vacancy.is_active ? "Скрыть" : "Показать"}
                            </button>
                          </form>
                          <form action={deleteVacancyAction}>
                            <input type="hidden" name="id" value={vacancy.id} />
                            <ConfirmSubmitButton message={`Удалить вакансию «${vacancy.title}»?`} className="rounded-full border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50">
                              Удалить
                            </ConfirmSubmitButton>
                          </form>
                        </div>
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
