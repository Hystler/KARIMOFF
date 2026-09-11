"use client";

import { useActionState, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import styles from "./KitchenWorkspace.module.css";
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
import { kitchenStations, kitchenStationLabels, kitchenViewStatus, stationItems, stationStatus, type KitchenView } from "@/lib/order-flow/kitchen-stations";

const columns: Array<{ status: KitchenStatus; title: string; empty: string }> = [
  { status: "new", title: "Новые", empty: "Новых заказов нет" },
  { status: "cooking", title: "Готовятся", empty: "Сейчас ничего не готовится" },
  { status: "ready", title: "Готово", empty: "Нет заказов к выдаче" }
];

const actionLabels: Partial<Record<KitchenStatus, string>> = {
  cooking: "Начать готовить",
  ready: "Готово",
  handed_out: "Выдан"
};
const stationPreferenceKey = "karimoff.kitchen.station.v1";

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
  view,
  onRecipe
}: {
  order: OrderFlowOrder;
  role: OrderActorRole;
  sla: KitchenSla;
  now: number;
  view: KitchenView;
  onRecipe: (item: OrderFlowItem) => void;
}) {
  const [state, action, pending] = useActionState(transitionKitchenOrderAction, initialKitchenActionState);
  const anchor = order.fulfillmentMode === "scheduled" && order.requestedAt
    ? order.requestedAt
    : order.operationalStartedAt;
  const elapsed = operationalElapsedSeconds(anchor, now);
  const tone = elapsed === null ? "normal" : classifySla(elapsed, sla);
  const visibleItems = stationItems(order, view);
  const viewStatus = kitchenViewStatus(order, view);
  const target = order.kitchenStatus === "ready" ? "handed_out" : undefined;
  const canAdvance = target ? canTransitionKitchen(role, order.kitchenStatus, target) : false;
  const toneClasses = viewStatus === "ready"
    ? "border-emerald-500 bg-emerald-50"
    : viewStatus === "cooking"
      ? "border-amber-400 bg-amber-50"
      : "border-red-500 bg-red-50";

  return (
    <article className={`${styles.ticket} rounded-lg border-2 shadow-sm ${toneClasses}`} data-order-ticket={order.id}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-xl font-black tabular-nums">{order.displayNumber}</strong>
            <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-black uppercase text-black/55">{orderSourceLabel(order.source)}</span>
            {order.isTest ? <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-black uppercase text-sky-800">Test</span> : null}
          </div>
          <p className="mt-1 break-words text-sm font-bold text-black/65">{order.publicDisplayName}</p>
        </div>
        <div className={`shrink-0 rounded-md px-2 py-1 text-right ${tone === "critical" ? "bg-red-600 text-white" : tone === "warning" ? "bg-amber-400 text-black" : "bg-[#121214] text-white"}`}>
          <p className="font-mono text-base font-black tabular-nums">{elapsed === null ? "—" : formatElapsed(elapsed)}</p>
        </div>
      </header>

      <div className="mt-2 flex flex-wrap gap-1 text-xs font-bold text-black/60">
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

      <div className={styles.lines}>
        {visibleItems.map((item) => (
          <button key={item.id} type="button" onClick={() => onRecipe(item)} title={`Техкарта: ${item.name}`} className={styles.line}>
            <div className="flex items-start justify-between gap-3">
              <span className="font-bold leading-5">{item.kitchenStatus === "ready" ? <CheckCircle2 size={14} className="mr-1 inline text-emerald-700" aria-label="Готово" /> : null}{item.name}</span>
              <strong className="shrink-0 text-lg tabular-nums text-[#D95405]">×{item.quantity}</strong>
            </div>
            {item.modifiers.map((modifier) => (
              <p key={modifier.id} className={`mt-1 rounded px-2 py-1 text-xs font-black uppercase leading-4 ${modifier.type === "remove" ? "bg-amber-100 text-amber-950" : modifier.type === "replace" ? "bg-sky-100 text-sky-900" : "bg-emerald-100 text-emerald-900"}`}>
                {modifierLabel(modifier)}
              </p>
            ))}
            {item.itemNote ? <p className="mt-2 rounded-md bg-violet-100 px-2.5 py-2 text-sm font-black leading-5 text-violet-950">К позиции: {item.itemNote}</p> : null}
            <PanelRightClose size={13} className="mt-1 text-black/40" aria-hidden="true" />
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

      {view !== "all" && viewStatus === "ready" && order.kitchenStatus !== "ready" ? <p className={styles.waiting}>Станция готова. Остальные позиции: {order.items.filter((item) => item.kitchenStatus !== "ready").length}</p> : null}
      <div className={styles.actions}>
        {order.kitchenStatus !== "ready" ? kitchenStations.filter((station) => view === "all" || view === station).map((station) => {
          const items = stationItems(order, station);
          if (!items.length) return null;
          const from = stationStatus(items);
          const to = from === "new" ? "cooking" : "ready";
          if (from === "ready") return <p className={styles.stationDone} key={station}><CheckCircle2 size={16} />{kitchenStationLabels[station]}: готово</p>;
          if (!canTransitionKitchen(role, from, to)) return null;
          return <form action={action} key={station}>
            <input type="hidden" name="order_id" value={order.id} />
            <input type="hidden" name="from_status" value={from} />
            <input type="hidden" name="to_status" value={to} />
            <input type="hidden" name="station" value={station} />
            <input type="hidden" name="device_source" value="kds" />
            <button type="submit" disabled={pending} className={`${styles.advance} ${to === "ready" ? styles.ready : styles.start}`}>
              {to === "ready" ? <CheckCircle2 size={18} /> : <ChefHat size={18} />}
              <span>{view === "all" ? `${kitchenStationLabels[station]} · ` : ""}{pending ? "Сохраняем…" : actionLabels[to]}</span>
            </button>
          </form>;
        }) : null}
        {canAdvance && target ? (
          <form action={action}>
            <input type="hidden" name="order_id" value={order.id} />
            <input type="hidden" name="from_status" value={order.kitchenStatus} />
            <input type="hidden" name="to_status" value={target} />
            <input type="hidden" name="device_source" value="kds" />
            <button type="submit" disabled={pending} className={`${styles.advance} ${styles.ready}`}>
              <CheckCircle2 size={18} />
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
            <button type="submit" disabled={pending} className={styles.cancel}>Отменить заказ</button>
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
  const [view, setView] = useState<KitchenView>("all");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const selectView = (next: KitchenView) => {
    setView(next);
    try { window.localStorage.setItem(stationPreferenceKey, next); } catch { /* Storage may be disabled on a shared terminal. */ }
  };
  const visibleOrders = orders.filter((order) => stationItems(order, view).length > 0);
  const queueColumns = columns.map((column) => ({
    ...column,
    orders: visibleOrders.filter((order) => kitchenViewStatus(order, view) === column.status
      || (column.status === "new" && kitchenViewStatus(order, view) === "accepted"))
  }));
  const realtime = useOrderRealtime(location.id, () => router.refresh(), initialCursor);
  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      setNow(Date.now());
      try {
        const saved = window.localStorage.getItem(stationPreferenceKey);
        if (saved === "all" || saved === "snacks" || saved === "main") setView(saved);
      } catch { /* The default view remains usable without storage. */ }
    }, 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        workspace.querySelectorAll<HTMLElement>(`.${styles.tickets}`).forEach((list) => {
          list.style.setProperty("--ticket-list-height", `${Math.max(160, window.innerHeight - list.getBoundingClientRect().top - 20)}px`);
        });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    if (workspace.parentElement) observer.observe(workspace.parentElement);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); cancelAnimationFrame(frame); };
  }, [view, embedded]);
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
    <div ref={workspaceRef} className={`${styles.workspace} ${embedded ? "min-w-0" : "min-h-dvh bg-[#f0f2f3] text-[#121214]"}`}>
      <header className={embedded ? "mb-3" : "border-b border-black/10 bg-[#121214] text-white"}>
        <div className={embedded ? "" : "mx-auto max-w-[2200px] px-3 py-3 sm:px-4"}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className={`text-xs font-black uppercase ${embedded ? "text-[#C94F05]" : "text-[#FF9A5C]"}`}>KARIMOFF KDS · {location.name}</p>
              <h1 className={`mt-1 text-xl font-black leading-tight ${embedded ? "" : "text-white"}`}>Кухня <span className="text-sm font-normal opacity-65">· {staffName}</span></h1>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
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
              <button type="button" onClick={() => router.refresh()} className={`grid h-11 w-11 place-items-center rounded-lg ${embedded ? "border border-black/10 bg-white" : "bg-white/10"}`} aria-label="Обновить очередь" title="Обновить очередь">
                <RefreshCw size={19} />
              </button>
              {!embedded && role !== "cook" ? <a href="/pos" className="inline-flex min-h-11 items-center rounded-lg bg-[#FB670A] px-4 text-sm font-black text-white">POS</a> : null}
            </div>
          </div>
          <div className={styles.stats}>
            {stats.map(({ label, value, icon: Icon }) => (
              <div key={label} className={styles.stat}>
                <Icon size={15} className={label === "Просрочено" && overdue ? "text-red-500" : "text-[#FB670A]"} />
                <span className="text-xs opacity-65">{label}</span><strong className="text-sm tabular-nums">{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className={embedded ? "" : "mx-auto max-w-[2200px] p-3 sm:p-4"}>
        <div className={styles.tabs} role="tablist" aria-label="Станция кухни">
          {([['all', 'Все'], ['snacks', 'Закуски'], ['main', 'Основные блюда']] as const).map(([key, label]) => <button
            key={key} type="button" role="tab" id={`station-tab-${key}`} aria-selected={view === key} aria-controls="kitchen-queue"
            onClick={() => selectView(key)} title={key === "main" ? "Бургеры, шаурма, роллы, хот-доги" : label}
          >{label}<span>{orders.filter((order) => stationItems(order, key).length > 0).length}</span></button>)}
        </div>
        <div id="kitchen-queue" role="tabpanel" aria-labelledby={`station-tab-${view}`} className={styles.board}
          style={{ "--kitchen-columns": queueColumns.map((column) => column.orders.length ? "minmax(0, 1fr)" : "140px").join(" ") } as CSSProperties}>
          {queueColumns.map((column) => {
            const items = column.orders;
            return (
              <section key={column.status} aria-labelledby={`column-${column.status}`} className={styles.column}>
                <div className="mb-2 flex items-center justify-between gap-3 px-1">
                  <h2 id={`column-${column.status}`} className="text-base font-black">{column.title}</h2>
                  <span className="grid h-8 min-w-8 place-items-center rounded-full bg-[#121214] px-2 text-xs font-black text-white">{items.length}</span>
                </div>
                <div className={styles.tickets} tabIndex={items.length ? 0 : undefined} role="region" aria-label={`${column.title}: заказы`}>
                  {items.length ? items.map((order) => (
                    <OrderTicket key={`${order.id}:${view}`} order={order} view={view} role={role} sla={sla} now={now} onRecipe={setSelectedItem} />
                  )) : (
                    <p className="py-2 text-sm text-black/45">{column.empty}</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {selectedItem ? <RecipeDrawer item={selectedItem} onClose={() => setSelectedItem(null)} /> : null}
    </div>
  );
}
