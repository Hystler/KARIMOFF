"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChefHat,
  CircleDot,
  Clock3,
  CookingPot,
  MapPin,
  PackageCheck,
  PanelRightClose,
  RefreshCw,
  TimerReset,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import {
  transitionKitchenOrderAction
} from "@/app/kitchen/actions";
import { initialKitchenActionState } from "@/lib/order-flow/kitchen-action-state";
import { useOrderRealtime } from "@/hooks/useOrderRealtime";
import { canCancelOrder, canTransitionKitchen } from "@/lib/order-flow/permissions";
import { classifySla, formatElapsed, operationalElapsedSeconds } from "@/lib/order-flow/sla";
import {
  type KitchenOperationsMetrics,
  orderSourceLabel,
  type KitchenSla,
  type KitchenStatus,
  type OrderActorRole,
  type OrderFlowItem,
  type OrderFlowOrder,
  type OrderLocation
} from "@/lib/order-flow/types";

const columns: Array<{ status: KitchenStatus; title: string; empty: string }> = [
  { status: "new", title: "Новые", empty: "Новых заказов нет" },
  { status: "accepted", title: "Приняты", empty: "Нет принятых заказов" },
  { status: "cooking", title: "Готовятся", empty: "Сейчас ничего не готовится" },
  { status: "ready", title: "Готово", empty: "Нет заказов к выдаче" }
];

const nextStatus: Partial<Record<KitchenStatus, KitchenStatus>> = {
  new: "accepted",
  accepted: "cooking",
  cooking: "ready",
  ready: "handed_out"
};

const actionLabels: Partial<Record<KitchenStatus, string>> = {
  accepted: "Принять",
  cooking: "Начать готовить",
  ready: "Готово",
  handed_out: "Выдан"
};

function formatRequested(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow"
  }).format(new Date(value));
}

function stationLabel(value: string) {
  if (value === "grill") return "Гриль";
  if (value === "fryer") return "Фритюр";
  if (value === "assembly") return "Сборка";
  if (value === "drinks") return "Напитки";
  if (value === "packing") return "Упаковка";
  return value;
}

function modifierPrefix(type: OrderFlowItem["modifiers"][number]["type"]) {
  if (type === "remove") return "БЕЗ";
  if (type === "replace") return "ЗАМЕНА";
  return "+";
}

function modifierLabel(modifier: OrderFlowItem["modifiers"][number]) {
  const cleaned = modifier.name
    .replace(/^\s*без\s+/i, "")
    .replace(/^\s*\+\s*/, "")
    .replace(/^\s*замена\s*:?\s*/i, "")
    .trim();
  return `${modifierPrefix(modifier.type)} ${cleaned || modifier.name}`;
}

function RecipeDrawer({ item, onClose }: { item: OrderFlowItem; onClose: () => void }) {
  const recipe = item.recipe;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="recipe-title">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Закрыть техкарту" />
      <aside className="relative z-10 h-full w-full max-w-xl overflow-y-auto bg-[#F7F5F1] p-5 shadow-2xl sm:p-7">
        <header className="flex items-start justify-between gap-4 border-b border-black/10 pb-5">
          <div>
            <p className="text-xs font-black uppercase text-[#C94F05]">Технологическая карта · ×{item.quantity}</p>
            <h2 id="recipe-title" className="mt-2 text-3xl font-black leading-tight">{item.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-black/10 bg-white" aria-label="Закрыть">
            <X size={22} />
          </button>
        </header>

        {item.modifiers.length ? (
          <section className="mt-5 rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-black text-amber-950"><AlertTriangle size={18} /> Изменения гостя</h3>
            <ul className="mt-3 grid gap-2">
              {item.modifiers.map((modifier) => (
                <li key={modifier.id} className={`rounded-md px-3 py-2 text-base font-black uppercase ${modifier.type === "remove" ? "bg-amber-200 text-amber-950" : modifier.type === "replace" ? "bg-sky-100 text-sky-900" : "bg-emerald-100 text-emerald-900"}`}>
                  {modifierLabel(modifier)}
                  {modifier.type !== "remove" && modifier.quantity > 0 ? ` · ${modifier.quantity * item.quantity} ${modifier.unit}` : ""}
                  {modifier.kitchenNote ? <span className="mt-1 block text-xs normal-case opacity-70">{modifier.kitchenNote}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {item.itemNote ? (
          <p className="mt-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-black leading-6 text-violet-950">
            К позиции: {item.itemNote}
          </p>
        ) : null}

        {recipe?.allergens.length ? (
          <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
            Аллергены: {recipe.allergens.join(", ")}
          </p>
        ) : null}

        {recipe?.lines.length ? (
          <>
            <ol className="mt-6 grid gap-3">
              {recipe.lines.map((line, index) => {
              const removed = item.modifiers.some(
                (modifier) => modifier.type === "remove" && modifier.ingredientId === line.ingredientId
              );
              return (
                <li key={line.id} className={`rounded-lg border bg-white p-4 ${removed ? "border-amber-300 opacity-55" : "border-black/10"}`}>
                  {line.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={line.imageUrl} alt="" loading="lazy" decoding="async" className="mb-4 aspect-[16/9] w-full rounded-md bg-[#F3F1ED] object-cover" />
                  ) : null}
                  <div className="flex items-start gap-4">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#121214] text-sm font-black text-white">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className={`font-black ${removed ? "line-through" : ""}`}>{line.name}</h3>
                        <strong className="tabular-nums text-[#C94F05]">
                          {removed ? "НЕ ДОБАВЛЯТЬ" : `${line.quantity * item.quantity} ${line.unit}`}
                        </strong>
                      </div>
                      {line.step ? <p className="mt-2 text-sm font-semibold leading-6 text-black/70">{line.step}</p> : null}
                      {line.note ? <p className="mt-2 text-xs leading-5 text-black/50">{line.note}</p> : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {line.station ? <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-black text-black/55">{stationLabel(line.station)}</span> : null}
                        {line.preparationTimeSeconds ? <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-black text-black/55">{Math.ceil(line.preparationTimeSeconds / 60)} мин</span> : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
              })}
            </ol>
            {item.modifiers.some((modifier) => modifier.type === "add" || modifier.type === "replace") ? (
              <section className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <h3 className="text-sm font-black uppercase text-emerald-950">Добавить при сборке</h3>
                <div className="mt-3 grid gap-2">
                  {item.modifiers.filter((modifier) => modifier.type === "add" || modifier.type === "replace").map((modifier) => (
                    <p key={modifier.id} className="rounded-md bg-white px-3 py-2 font-black text-emerald-950">
                      {modifierLabel(modifier)}
                      {modifier.quantity > 0 ? ` · ${modifier.quantity * item.quantity} ${modifier.unit}` : ""}
                    </p>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className="mt-6 rounded-lg border border-dashed border-black/15 bg-white p-8 text-center">
            <CookingPot className="mx-auto text-black/25" size={32} />
            <h3 className="mt-3 font-black">Техкарта не заполнена</h3>
            <p className="mt-1 text-sm leading-6 text-black/50">Заказ виден кухне, но граммовки и шаги нужно заполнить в составе товара.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function OrderTicket({
  order,
  role,
  sla,
  now,
  onRecipe
}: {
  order: OrderFlowOrder;
  role: OrderActorRole;
  sla: KitchenSla;
  now: number;
  onRecipe: (item: OrderFlowItem) => void;
}) {
  const [state, action, pending] = useActionState(transitionKitchenOrderAction, initialKitchenActionState);
  const anchor = order.fulfillmentMode === "scheduled" && order.requestedAt
    ? order.requestedAt
    : order.operationalStartedAt;
  const elapsed = operationalElapsedSeconds(anchor, now);
  const tone = elapsed === null ? "normal" : classifySla(elapsed, sla);
  const target = nextStatus[order.kitchenStatus];
  const canAdvance = target ? canTransitionKitchen(role, order.kitchenStatus, target) : false;
  const toneClasses = tone === "critical"
    ? "border-red-500 bg-red-50/35"
    : tone === "warning"
      ? "border-amber-400 bg-amber-50/30"
      : order.kitchenStatus === "ready"
        ? "border-emerald-400 bg-emerald-50/35"
        : "border-black/10 bg-white";

  return (
    <article className={`rounded-lg border-2 p-4 shadow-sm transition ${toneClasses}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-2xl font-black tabular-nums">{order.displayNumber}</strong>
            <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-black uppercase text-black/55">{orderSourceLabel(order.source)}</span>
            {order.isTest ? <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-black uppercase text-sky-800">Test</span> : null}
          </div>
          <p className="mt-1 truncate text-base font-bold text-black/65">{order.publicDisplayName}</p>
        </div>
        <div className={`shrink-0 rounded-lg px-3 py-2 text-right ${tone === "critical" ? "bg-red-600 text-white" : tone === "warning" ? "bg-amber-400 text-black" : "bg-[#121214] text-white"}`}>
          <p className="text-[10px] font-black uppercase opacity-70">Время</p>
          <p className="mt-0.5 font-mono text-lg font-black tabular-nums">{elapsed === null ? "—" : formatElapsed(elapsed)}</p>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-black/60">
        <span className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-black/5 px-2.5">
          {order.fulfillmentType === "pickup" ? <PackageCheck size={15} /> : <MapPin size={15} />}
          {order.fulfillmentType === "pickup" ? "Самовывоз" : "Доставка"}
        </span>
        {order.fulfillmentMode === "scheduled" && order.requestedAt ? (
          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[#FB670A]/10 px-2.5 text-[#B84704]">
            <Clock3 size={15} /> К {formatRequested(order.requestedAt)}
          </span>
        ) : null}
        {tone !== "normal" ? (
          <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 ${tone === "critical" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>
            <AlertTriangle size={15} /> {tone === "critical" ? "Просрочен" : "Скоро SLA"}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2">
        {order.items.map((item) => (
          <button key={item.id} type="button" onClick={() => onRecipe(item)} className="rounded-lg border border-black/10 bg-white p-3 text-left transition hover:border-[#FB670A] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#FB670A]/20">
            <div className="flex items-start justify-between gap-3">
              <span className="font-black leading-5">{item.name}</span>
              <strong className="shrink-0 text-lg tabular-nums text-[#D95405]">×{item.quantity}</strong>
            </div>
            {item.modifiers.map((modifier) => (
              <p key={modifier.id} className={`mt-2 rounded-md px-2.5 py-2 text-sm font-black uppercase leading-5 ${modifier.type === "remove" ? "bg-amber-100 text-amber-950" : modifier.type === "replace" ? "bg-sky-100 text-sky-900" : "bg-emerald-100 text-emerald-900"}`}>
                {modifierLabel(modifier)}
              </p>
            ))}
            {item.itemNote ? <p className="mt-2 rounded-md bg-violet-100 px-2.5 py-2 text-sm font-black leading-5 text-violet-950">К позиции: {item.itemNote}</p> : null}
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-black/40"><PanelRightClose size={13} /> Открыть техкарту</p>
          </button>
        ))}
      </div>

      {order.comment ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-bold leading-5 text-amber-900">
          {order.comment}
        </p>
      ) : null}

      {state.status !== "idle" ? (
        <div role="status" aria-live="polite" className={`mt-3 rounded-lg px-3 py-2 text-xs font-bold ${state.status === "error" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
          {state.message}
          {state.warnings?.length ? <span className="mt-1 block">{state.warnings.join(" ")}</span> : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-2">
        {canAdvance && target ? (
          <form action={action}>
            <input type="hidden" name="order_id" value={order.id} />
            <input type="hidden" name="from_status" value={order.kitchenStatus} />
            <input type="hidden" name="to_status" value={target} />
            <input type="hidden" name="device_source" value="kds" />
            <button type="submit" disabled={pending} className={`inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg px-4 text-base font-black shadow-sm transition active:scale-[0.99] disabled:opacity-50 ${target === "ready" || target === "handed_out" ? "bg-emerald-600 text-white" : "bg-[#FB670A] text-white"}`}>
              {target === "ready" || target === "handed_out" ? <CheckCircle2 size={22} /> : <ChefHat size={22} />}
              {pending ? "Сохраняем…" : actionLabels[target]}
            </button>
          </form>
        ) : null}
        {canCancelOrder(role) && order.kitchenStatus !== "ready" ? (
          <form action={action}>
            <input type="hidden" name="order_id" value={order.id} />
            <input type="hidden" name="from_status" value={order.kitchenStatus} />
            <input type="hidden" name="to_status" value="cancelled" />
            <input type="hidden" name="device_source" value="kds" />
            <button type="submit" disabled={pending} className="min-h-11 w-full rounded-lg border border-red-200 text-sm font-bold text-red-700 disabled:opacity-50">Отменить</button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

export function KitchenWorkspace({
  orders,
  location,
  locations,
  sla,
  metrics,
  role,
  staffName,
  initialCursor,
  embedded = false
}: {
  orders: OrderFlowOrder[];
  location: OrderLocation;
  locations: OrderLocation[];
  sla: KitchenSla;
  metrics: KitchenOperationsMetrics;
  role: OrderActorRole;
  staffName: string;
  initialCursor: number;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState(0);
  const [selectedItem, setSelectedItem] = useState<OrderFlowItem | null>(null);
  const realtime = useOrderRealtime(location.id, () => router.refresh(), initialCursor);
  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);
  const active = orders.filter((order) => order.kitchenStatus !== "ready");
  const elapsedValues = active.flatMap((order) => {
    const anchor = order.fulfillmentMode === "scheduled" && order.requestedAt
      ? order.requestedAt
      : order.operationalStartedAt;
    const elapsed = operationalElapsedSeconds(anchor, now);
    return elapsed === null ? [] : [elapsed];
  });
  const overdue = elapsedValues.filter((elapsed) => classifySla(elapsed, sla) === "critical").length;
  const longest = elapsedValues.length ? Math.max(...elapsedValues) : null;
  const stats = [
    { label: "Активные", value: active.length, icon: CircleDot },
    { label: "Готовятся", value: orders.filter((order) => order.kitchenStatus === "cooking").length, icon: CookingPot },
    { label: "К выдаче", value: orders.filter((order) => order.kitchenStatus === "ready").length, icon: CheckCircle2 },
    { label: "Просрочено", value: overdue, icon: AlertTriangle },
    { label: "Самый долгий", value: longest === null ? "—" : formatElapsed(longest), icon: TimerReset },
    { label: "Средняя готовка", value: metrics.averageCookingSeconds === null ? "—" : formatElapsed(metrics.averageCookingSeconds), icon: ChefHat },
    { label: "За час", value: metrics.throughputLastHour, icon: CheckCircle2 }
  ];

  return (
    <main className={embedded ? "min-w-0" : "min-h-dvh bg-[#F3F1ED] text-[#121214]"}>
      <header className={embedded ? "mb-5" : "sticky top-0 z-30 border-b border-black/10 bg-[#121214] text-white shadow-lg"}>
        <div className={embedded ? "" : "mx-auto max-w-[1900px] px-4 py-4 sm:px-6"}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className={`text-xs font-black uppercase ${embedded ? "text-[#C94F05]" : "text-[#FF9A5C]"}`}>KARIMOFF KDS · {location.name}</p>
              <h1 className={`mt-1 font-black leading-tight ${embedded ? "text-3xl" : "text-2xl text-white sm:text-3xl"}`}>Кухня в реальном времени</h1>
              <p className={`mt-1 text-sm ${embedded ? "text-black/55" : "text-white/55"}`}>{staffName}</p>
            </div>
            <div className="flex items-center gap-2">
              {locations.length > 1 ? (
                <select
                  value={location.id}
                  onChange={(event) => router.push(`${embedded ? "/admin/kitchen" : "/kitchen"}?location=${encodeURIComponent(event.target.value)}`)}
                  aria-label="Точка кухни"
                  className={`min-h-11 max-w-[220px] rounded-lg border px-3 text-sm font-black ${embedded ? "border-black/10 bg-white text-black" : "border-white/15 bg-white/10 text-white"}`}
                >
                  {locations.map((item) => <option key={item.id} value={item.id} className="text-black">{item.name}</option>)}
                </select>
              ) : null}
              <span className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-black ${embedded ? "border border-black/10 bg-white" : "bg-white/10"}`}>
                {realtime === "online" ? <Wifi size={17} className="text-emerald-500" /> : <WifiOff size={17} className="text-amber-500" />}
                {realtime === "online" ? "Онлайн" : realtime === "offline" ? "Нет сети" : "Резервное обновление"}
              </span>
              <button type="button" onClick={() => router.refresh()} className={`grid h-11 w-11 place-items-center rounded-lg ${embedded ? "border border-black/10 bg-white" : "bg-white/10"}`} aria-label="Обновить очередь">
                <RefreshCw size={19} />
              </button>
              {!embedded && role !== "cook" ? <a href="/pos" className="inline-flex min-h-11 items-center rounded-lg bg-[#FB670A] px-4 text-sm font-black text-white">POS</a> : null}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
            {stats.map(({ label, value, icon: Icon }) => (
              <div key={label} className={`flex min-h-[72px] items-center gap-3 rounded-lg px-3 ${embedded ? "border border-black/10 bg-white" : "bg-white/[0.08]"}`}>
                <Icon size={20} className={label === "Просрочено" && overdue ? "text-red-500" : "text-[#FB670A]"} />
                <div><p className={`text-[10px] font-black uppercase ${embedded ? "text-black/45" : "text-white/45"}`}>{label}</p><p className="mt-0.5 text-xl font-black tabular-nums">{value}</p></div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className={embedded ? "" : "mx-auto max-w-[1900px] p-4 sm:p-6"}>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {columns.map((column) => {
            const items = orders.filter((order) => order.kitchenStatus === column.status);
            return (
              <section key={column.status} aria-labelledby={`column-${column.status}`} className="min-w-0">
                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                  <h2 id={`column-${column.status}`} className="text-xl font-black">{column.title}</h2>
                  <span className="grid h-8 min-w-8 place-items-center rounded-full bg-[#121214] px-2 text-xs font-black text-white">{items.length}</span>
                </div>
                <div className="grid gap-3">
                  {items.length ? items.map((order) => (
                    <OrderTicket key={order.id} order={order} role={role} sla={sla} now={now} onRecipe={setSelectedItem} />
                  )) : (
                    <div className="grid min-h-[116px] place-items-center rounded-lg border border-dashed border-black/15 bg-white/60 p-4 text-center text-sm font-semibold text-black/35">{column.empty}</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {selectedItem ? <RecipeDrawer item={selectedItem} onClose={() => setSelectedItem(null)} /> : null}
    </main>
  );
}
