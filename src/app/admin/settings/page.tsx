import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminSiteSettings } from "@/lib/settings";
import { logoutAction } from "../login/actions";
import { updateSiteSettingsAction } from "./actions";

type AdminSettingsPageProps = {
  searchParams?: Promise<{
    error?: string;
    saved?: string;
  }>;
};

export const dynamic = "force-dynamic";

function getMessage(params: Awaited<NonNullable<AdminSettingsPageProps["searchParams"]>>) {
  if (params.saved) {
    return { tone: "success", text: "Настройки сохранены." };
  }

  if (params.error === "supabase") {
    return { tone: "error", text: "Supabase не подключён. Заполните переменные окружения." };
  }

  if (params.error) {
    return { tone: "error", text: `Ошибка: ${decodeURIComponent(params.error)}` };
  }

  return null;
}

export default async function AdminSettingsPage({ searchParams }: AdminSettingsPageProps) {
  const isAuthed = await isAdminAuthenticated();

  if (!isAuthed) {
    redirect("/admin/login");
  }

  const params = searchParams ? await searchParams : {};
  const message = getMessage(params);
  const { settings, notConfigured, error } = await getAdminSiteSettings();

  return (
    <main className="min-h-screen bg-karimoff-cream px-5 py-8 text-karimoff-black">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/admin" className="text-sm font-semibold text-karimoff-muted transition hover:text-karimoff-orange">
              Админка
            </Link>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Настройки</h1>
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

        {notConfigured ? (
          <div className="mt-8 rounded-lg border border-karimoff-line bg-white p-8 text-karimoff-muted shadow-card">
            Supabase не подключён. Заполните переменные окружения.
          </div>
        ) : error ? (
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-8 text-red-700">{error}</div>
        ) : (
          <form action={updateSiteSettingsAction} className="mt-8 grid gap-6 rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:p-7">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Название сайта
                <input name="site_name" required defaultValue={settings.site_name} className="rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange" />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Телефон
                <input name="phone" defaultValue={settings.phone ?? ""} className="rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange" />
              </label>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Адрес
                <input name="address" defaultValue={settings.address ?? ""} className="rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange" />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Часы работы
                <input name="working_hours" defaultValue={settings.working_hours ?? ""} className="rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange" />
              </label>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Тема по умолчанию
                <select name="theme" defaultValue={settings.theme} className="rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange">
                  <option value="light">Дневная</option>
                  <option value="dark">Ночная</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Процент лояльности
                <input name="loyalty_percent" type="number" min="0" max="100" step="0.1" defaultValue={settings.loyalty_percent} className="rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange" />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input name="delivery_enabled" type="checkbox" defaultChecked={settings.delivery_enabled} className="h-5 w-5 accent-karimoff-orange" />
                Доставка включена
              </label>
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input name="pickup_enabled" type="checkbox" defaultChecked={settings.pickup_enabled} className="h-5 w-5 accent-karimoff-orange" />
                Самовывоз включён
              </label>
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input name="loyalty_enabled" type="checkbox" defaultChecked={settings.loyalty_enabled} className="h-5 w-5 accent-karimoff-orange" />
                Лояльность включена
              </label>
            </div>

            <label className="grid gap-2 text-sm font-semibold">
              Hero title
              <input name="hero_title" defaultValue={settings.hero_title ?? ""} className="rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange" placeholder="Ресторанный вкус по цене обычного перекуса" />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Hero subtitle
              <textarea name="hero_subtitle" rows={3} defaultValue={settings.hero_subtitle ?? ""} className="resize-none rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange" placeholder="Первый фастфуд, приготовленный для вас с любовью." />
            </label>

            <button
              type="submit"
              className="rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-4 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
            >
              Сохранить
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
