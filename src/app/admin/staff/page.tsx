import { redirect } from "next/navigation";
import { PhoneInput } from "@/components/forms/PhoneInput";
import { getCurrentStaff } from "@/lib/admin-auth";
import { createDatabaseServerClient } from "@/lib/database/server";
import { createStaffAction, toggleStaffAction } from "./actions";

const roleLabels = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Управляющий",
  cashier: "Кассир",
  cook: "Повар"
} as const;

export const dynamic = "force-dynamic";

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const actor = await getCurrentStaff();
  if (!actor) redirect("/admin/login");
  if (!["owner", "admin"].includes(actor.role)) redirect("/admin");

  const params = await searchParams;
  const database = createDatabaseServerClient();
  const { data } = database
    ? await database.from("staff_users").select("id, name, phone, role, is_active, last_login_at, created_at").order("created_at")
    : { data: [] };

  return (
    <main className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">Команда</p>
          <h1>Сотрудники и доступы</h1>
          <p>Создавайте отдельные входы и выдавайте только нужную роль.</p>
        </div>
      </header>

      {params.error ? <div className="admin-alert admin-alert-error">{decodeURIComponent(params.error)}</div> : null}
      {params.saved ? <div className="admin-alert admin-alert-success">Изменения сохранены.</div> : null}

      <section className="admin-card p-5 sm:p-6">
        <h2 className="text-xl font-black">Новый сотрудник</h2>
        <form action={createStaffAction} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="admin-field">Имя<input name="name" required placeholder="Имя сотрудника" /></label>
          <label className="admin-field">Телефон<PhoneInput name="phone" required /></label>
          <label className="admin-field">Роль
            <select name="role" defaultValue="cook">
              <option value="cook">Повар</option>
              <option value="cashier">Кассир</option>
              <option value="manager">Управляющий</option>
              <option value="admin">Администратор</option>
              <option value="owner">Владелец</option>
            </select>
          </label>
          <label className="admin-field">Временный пароль<input name="password" type="password" minLength={10} required placeholder="От 10 символов" /></label>
          <button type="submit" className="admin-primary-button md:col-span-2 xl:col-span-4">Добавить сотрудника</button>
        </form>
      </section>

      <section className="mt-5 grid gap-3">
        {(data ?? []).map((staff) => (
          <article key={String(staff.id)} className="admin-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black">{String(staff.name)}</h2>
                <span className="admin-status">{roleLabels[staff.role as keyof typeof roleLabels] ?? String(staff.role)}</span>
                {!staff.is_active ? <span className="admin-status admin-status-muted">Отключён</span> : null}
              </div>
              <p className="mt-2 text-sm text-karimoff-muted">{String(staff.phone)}</p>
              <p className="mt-1 text-xs text-karimoff-muted">
                Последний вход: {staff.last_login_at ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(String(staff.last_login_at))) : "ещё не входил"}
              </p>
            </div>
            <form action={toggleStaffAction}>
              <input type="hidden" name="id" value={String(staff.id)} />
              <input type="hidden" name="is_active" value={String(!staff.is_active)} />
              <button type="submit" className={staff.is_active ? "admin-secondary-button text-red-600" : "admin-primary-button"}>
                {staff.is_active ? "Отключить" : "Включить"}
              </button>
            </form>
          </article>
        ))}
      </section>
    </main>
  );
}
