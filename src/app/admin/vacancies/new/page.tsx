import Link from "next/link";
import { redirect } from "next/navigation";
import { VacancyForm } from "@/components/admin/VacancyForm";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { logoutAction } from "../../login/actions";
import { createVacancyAction } from "../actions";

type NewVacancyPageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

export default async function NewVacancyPage({ searchParams }: NewVacancyPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const params = searchParams ? await searchParams : {};

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin/vacancies" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Вакансии
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Новая вакансия</h1>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="rounded-full border border-karimoff-black/20 bg-white px-5 py-3 text-sm font-semibold text-karimoff-black transition hover:border-karimoff-orange hover:text-karimoff-orange">
              Выйти
            </button>
          </form>
        </header>
        {params.error ? <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">{decodeURIComponent(params.error)}</div> : null}
        <VacancyForm action={createVacancyAction} submitLabel="Создать вакансию" />
      </div>
    </main>
  );
}
