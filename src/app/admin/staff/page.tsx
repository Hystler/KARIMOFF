import { ChevronDown, Trash2 } from "lucide-react";
import { redirect } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { StaffLocationPicker, type StaffLocationOption } from "@/components/admin/StaffLocationPicker";
import { PhoneInput } from "@/components/forms/PhoneInput";
import { getCurrentStaff } from "@/lib/admin-auth";
import { getOrderLocations } from "@/lib/order-flow/queries";
import { getPostgresSql } from "@/lib/postgres/server";
import { isStaffRole, type StaffRole } from "@/lib/staff-location-management";
import { createStaffAction, deleteStaffAction, toggleStaffAction, updateStaffAccessAction } from "./actions";
import { ORDER_TIME_ZONE } from "@/lib/order-time";

const roleLabels = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Управляющий",
  cashier: "Кассир",
  cook: "Повар"
} as const;

const errorMessages: Record<string, string> = {
  duplicate_phone: "Сотрудник с таким номером телефона уже существует.",
  invalid_fields: "Проверьте имя, телефон, роль и пароль от 10 символов.",
  location_required: "Для выбранной роли назначьте хотя бы одну активную точку.",
  invalid_location: "Одна из выбранных точек недоступна. Обновите страницу и проверьте список.",
  invalid_staff: "Нельзя изменить собственную учётную запись или роль.",
  staff_not_found: "Сотрудник не найден или уже удалён.",
  save: "Не удалось сохранить изменения. Проверьте данные и повторите попытку.",
  load_unavailable: "Не удалось загрузить сотрудников и точки. Повторите попытку позже."
};

export const dynamic = "force-dynamic";

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ deleted?: string; error?: string; saved?: string }> }) {
  const actor = await getCurrentStaff();
  if (!actor) redirect("/admin/login");
  if (!["owner", "admin"].includes(actor.role)) redirect("/admin");

  const params = await searchParams;
  let data: {
    id: string;
    name: string;
    phone: string;
    role: string;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    location_ids: string[];
  }[] = [];
  let locations: StaffLocationOption[] = [];
  let loadFailed = false;

  if (process.env.DATABASE_URL) {
    try {
      const sql = getPostgresSql();
      const rows = await sql<{
        id: string;
        name: string;
        phone: string;
        role: string;
        is_active: boolean;
        last_login_at: string | null;
        created_at: string;
      }[]>`
        select id, name, phone, role, is_active, last_login_at, created_at
        from public.staff_users
        order by created_at
      `;
      const orderLocations = await getOrderLocations();
      locations = orderLocations.map((location) => ({
        id: location.id,
        name: location.name,
        isDefault: location.isDefault
      }));
      const accessRows = rows.length
        ? await sql<{ staff_id: string; order_location_id: string }[]>`
            select staff_id, order_location_id
            from public.staff_location_access
            where staff_id = any(${rows.map((staff) => staff.id)}::uuid[])
              and order_location_id is not null
          `
        : [];
      const byStaff = new Map<string, string[]>();
      for (const access of accessRows) {
        const current = byStaff.get(access.staff_id) ?? [];
        current.push(access.order_location_id);
        byStaff.set(access.staff_id, current);
      }
      data = rows.map((staff) => ({ ...staff, location_ids: byStaff.get(staff.id) ?? [] }));
    } catch {
      loadFailed = true;
    }
  } else {
    loadFailed = true;
  }

  const defaultLocationIds = locations.filter((location) => location.isDefault).map((location) => location.id);

  return (
    <main className="admin-content">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">Команда</p>
          <h1>Сотрудники и доступы</h1>
        </div>
      </header>

      {params.error ? <div role="alert" className="admin-alert admin-alert-error">{errorMessages[params.error] ?? "Не удалось сохранить изменения."}</div> : null}
      {params.saved ? <div className="admin-alert admin-alert-success">Изменения сохранены.</div> : null}
      {params.deleted ? <div className="admin-alert admin-alert-success">Сотрудник удалён. Номер телефона можно использовать повторно.</div> : null}
      {loadFailed ? <div role="alert" className="admin-alert admin-alert-error">{errorMessages.load_unavailable}</div> : null}

      <details className="group border-y border-karimoff-line bg-white p-4" open={Boolean(params.error)}>
        <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-bold">Добавить сотрудника<ChevronDown size={17} className="transition-transform group-open:rotate-180" /></summary>
        <form action={createStaffAction} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="admin-field">Имя<input name="name" required placeholder="Имя сотрудника" /></label>
          <label className="admin-field">Телефон<PhoneInput name="phone" required /></label>
          <StaffLocationPicker locations={locations} initialSelected={defaultLocationIds} />
          <label className="admin-field">Временный пароль<input name="password" type="password" minLength={10} required placeholder="От 10 символов" /></label>
          <button type="submit" className="admin-primary-button md:col-span-2 xl:col-span-4">Добавить сотрудника</button>
        </form>
      </details>

      <section className="mt-5 max-w-full overflow-x-auto border-y border-karimoff-line bg-white" aria-label="Сотрудники">
        <table className="admin-table min-w-[920px]">
          <thead><tr><th>Имя / телефон</th><th>Роль</th><th>Доступные точки</th><th>Последний вход</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody>
          {data.map((staff) => {
            const editableRole: StaffRole = isStaffRole(staff.role) ? staff.role : "cook";
            const knownRole = isStaffRole(staff.role);
            const allowedLocationNames = locations
              .filter((location) => staff.location_ids.includes(location.id))
              .map((location) => location.name);

            return (
              <tr key={staff.id}>
                <td><strong>{staff.name}</strong><p className="mt-1 text-xs text-karimoff-muted">{staff.phone}</p></td>
                <td>{knownRole ? roleLabels[editableRole] : staff.role}</td>
                <td className="max-w-xs text-sm">
                  {editableRole === "owner" || editableRole === "admin"
                    ? "Все точки"
                    : allowedLocationNames.join(", ") || <span className="text-red-700">Нет назначенных точек</span>}
                </td>
                <td>{staff.last_login_at ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: ORDER_TIME_ZONE }).format(new Date(staff.last_login_at)) : "Ещё не входил"}</td>
                <td><span className={staff.is_active ? "text-emerald-700" : "text-karimoff-muted"}>{staff.is_active ? "Активен" : "Отключён"}</span></td>
                <td>
                  <div className="flex flex-wrap items-center gap-2">
                    {knownRole && staff.id !== actor.id ? (
                      <details className="group">
                        <summary className="admin-secondary-button cursor-pointer list-none" title="Изменить роль и доступные точки">Роль и точки</summary>
                        <form action={updateStaffAccessAction} className="mt-2 grid w-80 max-w-[calc(100vw-3rem)] gap-3 border border-karimoff-line bg-white p-4 shadow-card">
                          <input type="hidden" name="id" value={staff.id} />
                          <StaffLocationPicker
                            locations={locations}
                            initialRole={editableRole}
                            initialSelected={staff.location_ids}
                          />
                          <button type="submit" className="admin-primary-button">Сохранить роль и точки</button>
                        </form>
                      </details>
                    ) : knownRole ? <span className="text-xs text-karimoff-muted">Свою роль изменить нельзя</span> : null}
                    <form action={toggleStaffAction}>
                      <input type="hidden" name="id" value={staff.id} />
                      <input type="hidden" name="is_active" value={String(!staff.is_active)} />
                      <button type="submit" className={staff.is_active ? "admin-secondary-button text-red-600" : "admin-primary-button"}>
                        {staff.is_active ? "Отключить" : "Включить"}
                      </button>
                    </form>
                    <form action={deleteStaffAction}>
                      <input type="hidden" name="id" value={staff.id} />
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
            );
          })}
          {!data.length ? <tr><td colSpan={6} className="text-karimoff-muted">Сотрудники ещё не добавлены</td></tr> : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
