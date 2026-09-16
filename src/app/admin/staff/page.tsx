import { ChevronDown, Trash2 } from "lucide-react";
import { redirect } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { PhoneInput } from "@/components/forms/PhoneInput";
import { getCurrentStaff } from "@/lib/admin-auth";
import { createDatabaseServerClient } from "@/lib/database/server";
import { createStaffAction, deleteStaffAction, toggleStaffAction } from "./actions";
import { ORDER_TIME_ZONE } from "@/lib/order-time";

const roleLabels = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Управляющий",
  cashier: "Кассир",
  cook: "Повар"
} as const;

export const dynamic = "force-dynamic";

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ deleted?: string; error?: string; saved?: string }> }) {
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
        </div>
      </header>

      {params.error ? <div role="alert" className="admin-alert admin-alert-error">{params.error}</div> : null}
      {params.saved ? <div className="admin-alert admin-alert-success">Изменения сохранены.</div> : null}
      {params.deleted ? <div className="admin-alert admin-alert-success">Сотрудник удалён. Номер телефона можно использовать повторно.</div> : null}

      <details className="group border-y border-karimoff-line bg-white p-4" open={Boolean(params.error)}>
        <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-bold">Добавить сотрудника<ChevronDown size={17} className="transition-transform group-open:rotate-180" /></summary>
        <form action={createStaffAction} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
      </details>

      <section className="mt-5 max-w-full overflow-x-auto border-y border-karimoff-line bg-white" aria-label="Сотрудники">
        <table className="admin-table min-w-[680px]">
          <thead><tr><th>Имя / телефон</th><th>Роль</th><th>Последний вход</th><th>Доступ</th><th>Действие</th></tr></thead>
          <tbody>
        {(data ?? []).map((staff) => (
          <tr key={String(staff.id)}>
            <td><strong>{String(staff.name)}</strong><p className="mt-1 text-xs text-karimoff-muted">{String(staff.phone)}</p></td>
            <td>{roleLabels[staff.role as keyof typeof roleLabels] ?? String(staff.role)}</td>
            <td>{staff.last_login_at ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: ORDER_TIME_ZONE }).format(new Date(String(staff.last_login_at))) : "Ещё не входил"}</td>
            <td><span className={staff.is_active ? "text-emerald-700" : "text-karimoff-muted"}>{staff.is_active ? "Активен" : "Отключён"}</span></td>
            <td>
              <div className="flex flex-wrap items-center gap-2">
                <form action={toggleStaffAction}>
                  <input type="hidden" name="id" value={String(staff.id)} />
                  <input type="hidden" name="is_active" value={String(!staff.is_active)} />
                  <button type="submit" className={staff.is_active ? "admin-secondary-button text-red-600" : "admin-primary-button"}>
                    {staff.is_active ? "Отключить" : "Включить"}
                  </button>
                </form>
                <form action={deleteStaffAction}>
                  <input type="hidden" name="id" value={String(staff.id)} />
                  <ConfirmSubmitButton
                    message={`Удалить сотрудника «${staff.name}»? Доступ будет закрыт, а номер телефона можно будет использовать повторно.`}
                    className="admin-secondary-button text-red-600"
                    aria-label={`Удалить сотрудника ${staff.name}`}
                    title="Удалить сотрудника"
                  >
                    <Trash2 size={15} />
                    Удалить
                  </ConfirmSubmitButton>
                </form>
              </div>
            </td>
          </tr>
        ))}
        {!data?.length ? <tr><td colSpan={5} className="text-karimoff-muted">Сотрудники ещё не добавлены</td></tr> : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
