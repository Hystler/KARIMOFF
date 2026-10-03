import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MapPinned, Search } from "lucide-react";
import { getCurrentStaff } from "@/lib/admin-auth";
import { normalizeHouse, normalizeStreet } from "@/lib/delivery/address-normalization.mjs";
import { getDefaultDeliveryLocationId } from "@/lib/delivery/address-whitelist";
import { getPostgresSql } from "@/lib/postgres/server";
import {
  bulkReviewDeliveryAddressesAction,
  saveManualDeliveryAddressAction,
  setDeliveryAddressAvailabilityAction,
  updateDeliveryAddressDisplayNameAction
} from "./actions";

export const metadata: Metadata = {
  title: "Адреса доставки · KARIMOFF",
  robots: { index: false, follow: false, nocache: true }
};

type AddressRow = {
  id: string;
  city: string | null;
  street: string;
  street_normalized: string;
  house: string;
  house_normalized: string;
  building: string;
  display_name: string | null;
  latitude: string;
  longitude: string;
  distance_meters: number;
  aerodrome_boundary_distance_meters: string | null;
  source: string;
  source_id: string | null;
  source_ids: string[];
  source_snapshot_version: string | null;
  duplicate_count: number;
  coordinate_spread_meters: string;
  review_reasons: string[];
  is_available: boolean;
  disabled_reason: string | null;
};

const reasonLabels: Record<string, string> = {
  AERODROME_BOUNDARY_WITHIN_100M: "до границы аэродрома не более 100 м",
  DELIVERY_RADIUS_REVIEW_2800_3000M: "пограничное расстояние 2,8–3 км",
  DUPLICATE_COORDINATE_CONFLICT: "адресные объекты расходятся по координатам",
  INVALID_COORDINATES: "некорректные координаты источника",
  MANUAL_ENTRY_REVIEW: "дом добавлен вручную и ожидает одобрения",
  MULTIPLE_HOUSE_NUMBERS: "источник содержит несколько номеров дома",
  SOURCE_COORDINATES_CHANGED: "координаты изменились в новом снимке",
  SUSPICIOUS_HOUSE_FORMAT: "неоднозначный формат номера дома",
  SUSPICIOUS_STREET_FORMAT: "подозрительный формат названия улицы",
  MISSING_COORDINATES: "у адреса нет координат"
};

function formatReason(value: string) {
  return reasonLabels[value] ?? value;
}

function feedbackFor(search: Record<string, string | string[] | undefined>) {
  const saved = typeof search.saved === "string" ? search.saved : "";
  const error = typeof search.error === "string" ? search.error : "";
  const savedMessages: Record<string, string> = {
    bulk_approved: "Выбранные адреса одобрены.",
    bulk_rejected: "Выбранные адреса отключены.",
    created: "Дом добавлен.",
    disabled: "Адрес отключён.",
    enabled: "Адрес включён.",
    updated: "Название сохранено."
  };
  const errors: Record<string, string> = {
    duplicate: "Такой дом для этой точки уже есть.",
    fields: "Проверьте улицу, дом и координаты.",
    id: "Не удалось определить адрес.",
    location: "Активная точка доставки не найдена.",
    missing: "Адрес не найден.",
    outside: "Адрес вне 3 км или внутри исключённой территории.",
    save: "Не удалось сохранить адрес.",
    selection: "Выберите адреса из очереди ручной проверки."
  };
  return { success: savedMessages[saved] ?? "", error: errors[error] ?? "" };
}

export default async function DeliveryAddressesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  if (!staff.legacy && !["owner", "admin"].includes(staff.role)) redirect("/admin");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const streetFilter = typeof params.street === "string" ? params.street.trim().slice(0, 180) : "";
  const mode = ["review", "available", "disabled", "all"].includes(String(params.mode)) ? String(params.mode) : "review";
  const locationId = await getDefaultDeliveryLocationId();
  const feedback = feedbackFor(params);
  if (!locationId) {
    return <main className="admin-content admin-content-wide"><h1>Адреса доставки</h1><p>Активная точка доставки не найдена.</p></main>;
  }

  const sql = getPostgresSql();
  const [counts] = await sql<{ total: number; available: number; review: number; disabled: number }[]>`
    select count(*)::int as total,
      count(*) filter (where is_available)::int as available,
      count(*) filter (where not is_available and disabled_reason = 'manual_review_required')::int as review,
      count(*) filter (where not is_available and disabled_reason is distinct from 'manual_review_required')::int as disabled
    from public.delivery_addresses where location_id = ${locationId}::uuid
  `;
  const streets = await sql<{ street: string; street_normalized: string; total: number }[]>`
    select min(street) as street, street_normalized, count(*)::int as total
    from public.delivery_addresses where location_id = ${locationId}::uuid
    group by street_normalized order by min(street)
  `;
  const escaped = query.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escaped}%`;
  const normalizedStreet = normalizeStreet(query);
  const normalizedHouse = normalizeHouse(query);
  const addresses = await sql<AddressRow[]>`
    select id, city, street, street_normalized, house, house_normalized, building, display_name,
      latitude::text, longitude::text, distance_meters,
      aerodrome_boundary_distance_meters::text, source, source_id, source_ids,
      source_snapshot_version, duplicate_count, coordinate_spread_meters::text,
      review_reasons, is_available, disabled_reason
    from public.delivery_addresses
    where location_id = ${locationId}::uuid
      and (${streetFilter} = '' or street_normalized = ${streetFilter})
      and (
        ${mode} = 'all'
        or (${mode} = 'review' and not is_available and disabled_reason = 'manual_review_required')
        or (${mode} = 'available' and is_available)
        or (${mode} = 'disabled' and not is_available and disabled_reason is distinct from 'manual_review_required')
      )
      and (${query} = '' or (
        street ilike ${pattern} or house ilike ${pattern} or building ilike ${pattern}
        or coalesce(city, '') ilike ${pattern} or coalesce(display_name, '') ilike ${pattern}
        or (${normalizedStreet} <> '' and street_normalized like ${`%${normalizedStreet}%`})
        or (${normalizedHouse} <> '' and house_normalized like ${`%${normalizedHouse}%`})
      ))
    order by street_normalized, house_normalized, building_normalized
    limit 500
  `;

  return (
    <main className="admin-content admin-content-wide">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">Доставка · одна точка</p>
          <h1 className="flex items-center gap-3"><MapPinned size={27} />Адреса доставки</h1>
          <p>Покупатель выбирает только дом из этого списка. Доступность проверяется по точке и статусу адреса.</p>
        </div>
        <div className="rounded-md bg-karimoff-cream px-4 py-3 text-sm font-bold text-karimoff-black">
          {counts?.total ?? 0} адресов · {streets.length} улиц
        </div>
      </header>

      <section className="mt-5 grid gap-3 sm:grid-cols-4" aria-label="Состояние whitelist">
          {[
            ["Доступны", counts?.available ?? 0, "available"],
            ["Требуют проверки", counts?.review ?? 0, "review"],
            ["Отключены", counts?.disabled ?? 0, "disabled"],
            ["За пределами зоны", "см. отчёт импорта", ""]
          ].map(([label, value, target]) => {
            const content = <><span className="block text-xs font-bold text-karimoff-muted">{label}</span><span className="mt-1 block text-xl font-black text-karimoff-black">{value}</span></>;
            return target
              ? <a key={String(label)} href={pagePathForMode(String(target))} className="rounded-lg border border-karimoff-line bg-white p-4">{content}</a>
              : <div key={String(label)} className="rounded-lg border border-karimoff-line bg-white p-4">{content}</div>;
          })}
      </section>

      {feedback.success ? <p role="status" className="mt-5 rounded-md bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{feedback.success}</p> : null}
      {feedback.error ? <p role="alert" className="mt-5 rounded-md bg-red-50 p-3 text-sm font-semibold text-red-800">{feedback.error}</p> : null}

      <nav className="analytics-subnav mt-5" aria-label="Статус адресов">
        {[
          ["review", "Ручная проверка"],
          ["available", "Доступны"],
          ["disabled", "Отключены"],
          ["all", "Все адреса"]
        ].map(([key, label]) => <a key={key} href={pagePathForMode(key)} aria-current={mode === key ? "page" : undefined} className={mode === key ? "is-active" : ""}>{label}</a>)}
      </nav>

      <section className="mt-4 rounded-lg border border-karimoff-line bg-white p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.6fr)_auto]">
          <input type="hidden" name="mode" value={mode} />
          <label className="grid gap-1.5 text-sm font-semibold text-karimoff-muted">
            Поиск
            <input name="q" defaultValue={query} className="public-field h-11" placeholder="Улица, дом или название" />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-karimoff-muted">
            Улица
            <select name="street" defaultValue={streetFilter} className="public-field h-11">
              <option value="">Все улицы</option>
              {streets.map((item) => <option key={item.street_normalized} value={item.street_normalized}>{item.street} · {item.total}</option>)}
            </select>
          </label>
          <button type="submit" className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-md bg-karimoff-black px-4 text-sm font-bold text-white">
            <Search size={16} />Найти
          </button>
        </form>

        {mode === "review" ? (
          <form id="bulk-review-form" action={bulkReviewDeliveryAddressesAction} className="mt-4 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-3">
            <strong className="mr-auto text-sm">Выберите спорные адреса для решения</strong>
            <button name="review_action" value="approve" className="min-h-10 rounded-md bg-emerald-700 px-3 text-xs font-bold text-white">Одобрить выбранные</button>
            <button name="review_action" value="reject" className="min-h-10 rounded-md bg-karimoff-black px-3 text-xs font-bold text-white">Отключить выбранные</button>
          </form>
        ) : null}

        <div className="mt-4 grid gap-3">
          {addresses.length ? addresses.map((address) => (
            <article key={address.id} className="grid gap-3 rounded-lg border border-karimoff-line p-4 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)_auto]">
              <div className="flex gap-3">
                {mode === "review" && address.disabled_reason === "manual_review_required" ? (
                  <input form="bulk-review-form" type="checkbox" name="address_id" value={address.id} aria-label={`Выбрать ${address.street}, ${address.house}`} className="mt-1 h-4 w-4 shrink-0 accent-karimoff-orange" />
                ) : null}
                <div>
                  <h2 className="font-bold">{address.city ? `${address.city}, ` : ""}{address.street}, {address.display_name || address.house}{address.building ? `, корп. ${address.building}` : ""}</h2>
                  <p className="mt-1 text-xs leading-5 text-karimoff-muted">
                    {address.distance_meters} м от точки · {address.latitude}, {address.longitude}
                    {address.aerodrome_boundary_distance_meters !== null ? ` · ${address.aerodrome_boundary_distance_meters} м до границы` : ""}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-karimoff-muted">
                    Источник: {address.source}{address.source_id ? ` · ${address.source_id}` : ""}
                    {address.source_snapshot_version ? ` · snapshot ${address.source_snapshot_version}` : ""}
                  </p>
                  {address.duplicate_count > 1 ? (
                    <p className="mt-1 text-xs font-semibold text-amber-800">
                      {address.duplicate_count} source objects · spread {address.coordinate_spread_meters} м · {address.source_ids.join(", ")}
                    </p>
                  ) : null}
                  {address.review_reasons.length ? (
                    <ul className="mt-2 list-disc pl-4 text-xs font-semibold leading-5 text-amber-800">
                      {address.review_reasons.map((reason) => <li key={reason}>{formatReason(reason)}</li>)}
                    </ul>
                  ) : null}
                </div>
              </div>
              <form action={updateDeliveryAddressDisplayNameAction} className="flex gap-2">
                <input type="hidden" name="id" value={address.id} />
                <label className="sr-only" htmlFor={`display-${address.id}`}>Отображаемое название дома</label>
                <input id={`display-${address.id}`} name="display_name" defaultValue={address.display_name ?? ""} className="public-field h-10 min-w-0 flex-1" placeholder="Отображаемое название" />
                <button className="rounded-md border border-karimoff-line px-3 text-xs font-bold">Сохранить</button>
              </form>
              <form action={setDeliveryAddressAvailabilityAction} className="flex items-center justify-end">
                <input type="hidden" name="id" value={address.id} />
                <input type="hidden" name="is_available" value={address.is_available ? "false" : "true"} />
                <button className={`min-h-10 rounded-md px-3 text-xs font-bold ${address.is_available ? "bg-emerald-100 text-emerald-900" : "bg-karimoff-cream text-karimoff-black"}`}>
                  {address.is_available ? "Выключить" : "Включить"}
                </button>
              </form>
            </article>
          )) : <p className="rounded-md bg-karimoff-cream p-4 text-sm text-karimoff-muted">В выбранном разделе адресов нет.</p>}
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-karimoff-line bg-white p-4">
        <h2 className="text-lg font-black">Добавить дом вручную</h2>
        <p className="mt-1 text-sm text-karimoff-muted">Город необязателен. Координаты используются только при управлении whitelist, checkout их не принимает.</p>
        <form action={saveManualDeliveryAddressAction} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1.5 text-sm font-semibold text-karimoff-muted">Город / населённый пункт (если известен)<input name="city" maxLength={100} className="public-field h-11" /></label>
          <label className="grid gap-1.5 text-sm font-semibold text-karimoff-muted">Улица<input name="street" required maxLength={160} className="public-field h-11" /></label>
          <label className="grid gap-1.5 text-sm font-semibold text-karimoff-muted">Дом<input name="house" required maxLength={40} className="public-field h-11" placeholder="5Б" /></label>
          <label className="grid gap-1.5 text-sm font-semibold text-karimoff-muted">Корпус<input name="building" maxLength={40} className="public-field h-11" placeholder="1" /></label>
          <label className="grid gap-1.5 text-sm font-semibold text-karimoff-muted">Отображаемое название<input name="display_name" maxLength={120} className="public-field h-11" /></label>
          <label className="grid gap-1.5 text-sm font-semibold text-karimoff-muted">Индекс<input name="postal_code" maxLength={20} className="public-field h-11" /></label>
          <label className="grid gap-1.5 text-sm font-semibold text-karimoff-muted">Широта<input name="latitude" required inputMode="decimal" className="public-field h-11" placeholder="55.909221" /></label>
          <label className="grid gap-1.5 text-sm font-semibold text-karimoff-muted">Долгота<input name="longitude" required inputMode="decimal" className="public-field h-11" placeholder="38.055708" /></label>
          <label className="flex items-center gap-2 text-sm font-semibold text-karimoff-muted lg:col-span-3">
            <input type="checkbox" name="is_available" className="h-4 w-4 accent-karimoff-orange" />Одобрить и сразу включить дом
          </label>
          <button type="submit" className="min-h-11 rounded-md bg-karimoff-black px-4 text-sm font-bold text-white">Добавить дом</button>
        </form>
      </section>

      <p className="mt-5 text-xs leading-5 text-karimoff-muted">
        Адресные данные: <a href="https://www.openstreetmap.org/copyright" className="underline">© OpenStreetMap contributors</a>,
        <a href="https://opendatacommons.org/licenses/odbl/1-0/" className="ml-1 underline">ODbL 1.0</a>.
      </p>
    </main>
  );
}

function pagePathForMode(mode: string) {
  return `/admin/delivery-addresses?mode=${encodeURIComponent(mode)}`;
}
