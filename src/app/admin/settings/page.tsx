import Link from "next/link";
import { redirect } from "next/navigation";
import { HeroBackgroundField } from "@/components/admin/HeroBackgroundField";
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

const heroBackgroundFields = [
  {
    key: "home_hero_image_url",
    title: "Главная",
    hint: "Рекомендуемый формат: 2400×1200 px, горизонтальное фото 2:1. Важный объект держите ближе к центру или правой части кадра. Текст будет поверх изображения."
  },
  {
    key: "menu_hero_image_url",
    title: "Меню",
    hint: "Рекомендуемый формат: 2400×1200 px, горизонтальное фото 2:1. Фото должно выдерживать затемнение overlay."
  },
  {
    key: "business_hero_image_url",
    title: "Для бизнеса",
    hint: "Рекомендуемый формат: 2400×1200 px, горизонтальное фото 2:1. Не используйте фото с мелким текстом."
  },
  {
    key: "careers_hero_image_url",
    title: "Работа",
    hint: "Рекомендуемый формат: 2400×1200 px, горизонтальное фото 2:1. На mobile фото будет кадрироваться."
  },
  {
    key: "franchise_hero_image_url",
    title: "Франшиза",
    hint: "Рекомендуемый формат: 2400×1200 px, горизонтальное фото 2:1. Фото должно быть читаемым под тёмным overlay."
  },
  {
    key: "about_hero_image_url",
    title: "О нас",
    hint: "Рекомендуемый формат: 2400×1200 px, горизонтальное фото 2:1. Ключевой объект держите ближе к центру."
  }
] as const;

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
          <form action={updateSiteSettingsAction} encType="multipart/form-data" className="mt-8 grid gap-6 rounded-lg border border-karimoff-line bg-white p-5 shadow-card sm:p-7">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Название сайта
                <input name="site_name" required defaultValue={settings.site_name} className="rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange" />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Телефон
                <input name="phone" defaultValue={settings.phone ?? "+7"} className="rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange" />
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
              <input name="hero_title" defaultValue={settings.hero_title ?? ""} className="rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange" placeholder="Первый фастфуд, приготовленный для вас с любовью" />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Hero subtitle
              <textarea name="hero_subtitle" rows={3} defaultValue={settings.hero_subtitle ?? ""} className="resize-none rounded-xl border border-karimoff-line px-4 py-3 outline-none focus:border-karimoff-orange" placeholder="Ресторанный вкус по цене обычного перекуса" />
            </label>

            <section className="rounded-[1.25rem] border border-karimoff-line bg-karimoff-cream/60 p-4 sm:p-5">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold text-karimoff-orange">Фоны страниц</p>
                <h2 className="mt-2 text-2xl font-black">Hero-фото для главной и разделов</h2>
                <p className="mt-3 text-sm leading-6 text-karimoff-muted">
                  Загружайте широкие фото 2400×1200 px, пропорция 2:1. Важный объект держите ближе к центру или правой части кадра:
                  текст будет поверх изображения.
                  На мобильной версии фото будет кадрироваться: не размещайте лицо, продукт или важный объект у самых краёв.
                  Не используйте фото с мелким текстом: на телефоне он будет нечитаем.
                  Желательно WebP/AVIF до 500 KB-1 MB, максимум для hero-фона — 5 MB.
                </p>
              </div>
              <div className="mt-6 grid gap-4">
                {heroBackgroundFields.map((field) => (
                  <HeroBackgroundField
                    key={field.key}
                    fieldKey={field.key}
                    hint={field.hint}
                    title={field.title}
                    value={settings[field.key]}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-[1.25rem] border border-karimoff-line bg-karimoff-cream/60 p-4 sm:p-5">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold text-karimoff-orange">Социальные сети</p>
                <h2 className="mt-2 text-2xl font-black">Ссылки для сайта</h2>
                <p className="mt-3 text-sm leading-6 text-karimoff-muted">
                  Если поле пустое, иконка не показывается. Telegram можно указать как https://t.me/username или tg://resolve?domain=username.
                </p>
              </div>
              <div className="mt-5 grid gap-5 md:grid-cols-3">
                <label className="grid gap-2 text-sm font-semibold">
                  Telegram
                  <input name="telegram_url" defaultValue={settings.telegram_url ?? ""} placeholder="https://t.me/username" className="rounded-xl border border-karimoff-line px-4 py-3 text-sm outline-none focus:border-karimoff-orange" />
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  Instagram
                  <input name="instagram_url" defaultValue={settings.instagram_url ?? ""} placeholder="https://instagram.com/username" className="rounded-xl border border-karimoff-line px-4 py-3 text-sm outline-none focus:border-karimoff-orange" />
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  TikTok
                  <input name="tiktok_url" defaultValue={settings.tiktok_url ?? ""} placeholder="https://www.tiktok.com/@username" className="rounded-xl border border-karimoff-line px-4 py-3 text-sm outline-none focus:border-karimoff-orange" />
                </label>
              </div>
            </section>

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
