import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import type {
  KitchenSla,
  KitchenOperationsMetrics,
  KitchenStatus,
  OrderFlowItem,
  OrderFlowModifier,
  OrderFlowOrder,
  OrderLocation,
  OrderRecipe,
  OrderSource
} from "./types";

type OrderRow = {
  id: string;
  display_number: string | null;
  source: string;
  location_id: string;
  location_name: string;
  created_at: string;
  accepted_at: string | null;
  cooking_started_at: string | null;
  ready_at: string | null;
  handed_out_at: string | null;
  requested_at: string | null;
  kitchen_status: KitchenStatus;
  status: string;
  payment_status: string;
  fiscal_status: string;
  public_display_name: string | null;
  public_avatar_seed: string | null;
  public_avatar_config: Record<string, unknown> | null;
  delivery_type: string;
  fulfillment_mode: string;
  comment: string | null;
  address: string | null;
  total: string | number;
  assigned_staff_name: string | null;
};

type ItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: string | number;
  line_total: string | number;
  allergens: string[] | null;
};

type ModifierRow = {
  id: string;
  order_item_id: string;
  ingredient_id: string | null;
  modifier_type: "remove" | "add";
  ingredient_name: string;
  quantity: string | number;
  unit: string;
};

function source(value: string): OrderSource {
  if (value === "pos" || value === "mobile" || value === "kiosk" || value === "aggregator") return value;
  return "web";
}

function mapModifier(row: ModifierRow): OrderFlowModifier {
  return {
    id: row.id,
    ingredientId: row.ingredient_id,
    type: row.modifier_type,
    name: row.ingredient_name,
    quantity: Number(row.quantity),
    unit: row.unit
  };
}

function mapItem(
  row: ItemRow,
  modifiers: OrderFlowModifier[],
  lines: OrderRecipe["lines"]
): OrderFlowItem {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.product_name,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total),
    modifiers,
    recipe: row.product_id
      ? {
          productId: row.product_id,
          productName: row.product_name,
          allergens: row.allergens ?? [],
          quantity: Number(row.quantity),
          lines
        }
      : null
  };
}

function mapOrder(row: OrderRow, items: OrderFlowItem[]): OrderFlowOrder {
  return {
    id: row.id,
    displayNumber: row.display_number || row.id.slice(0, 8).toUpperCase(),
    source: source(row.source),
    locationId: row.location_id,
    locationName: row.location_name,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    cookingStartedAt: row.cooking_started_at,
    readyAt: row.ready_at,
    handedOutAt: row.handed_out_at,
    requestedAt: row.requested_at,
    kitchenStatus: row.kitchen_status,
    orderStatus: row.status,
    paymentStatus: row.payment_status,
    fiscalStatus: row.fiscal_status,
    publicDisplayName: row.public_display_name || "Гость",
    publicAvatarSeed: row.public_avatar_seed || row.id,
    publicAvatar:
      row.public_avatar_config &&
      ["base", "eyes", "mouth", "accessory", "clothes", "background"].every(
        (key) => typeof row.public_avatar_config?.[key] === "string"
      )
        ? row.public_avatar_config as OrderFlowOrder["publicAvatar"]
        : null,
    fulfillmentType: row.delivery_type === "delivery" ? "delivery" : "pickup",
    fulfillmentMode: row.fulfillment_mode === "scheduled" ? "scheduled" : "asap",
    comment: row.comment,
    address: row.address,
    total: Number(row.total),
    assignedStaffName: row.assigned_staff_name,
    items
  };
}

export async function getOrderLocations(): Promise<OrderLocation[]> {
  const sql = getPostgresSql();
  const rows = await sql<{
    id: string;
    location_key: string;
    name: string;
    timezone: string;
    is_default: boolean;
  }[]>`
    select id, location_key, name, timezone, is_default
    from public.order_locations
    where is_active = true
    order by is_default desc, name
  `;
  return rows.map((row) => ({
    id: row.id,
    key: row.location_key,
    name: row.name,
    timezone: row.timezone,
    isDefault: row.is_default
  }));
}

export async function getKitchenSla(locationId: string): Promise<KitchenSla> {
  const sql = getPostgresSql();
  const rows = await sql<{
    warning_seconds: number;
    critical_seconds: number;
    ready_display_seconds: number;
    online_requires_paid: boolean;
    pos_requires_paid: boolean;
    inventory_trigger: "ready";
  }[]>`
    select warning_seconds, critical_seconds, ready_display_seconds,
      online_requires_paid, pos_requires_paid, inventory_trigger
    from public.kitchen_sla_settings
    where location_id = ${locationId}::uuid
    limit 1
  `;
  return {
    warningSeconds: Number(rows[0]?.warning_seconds ?? 300),
    criticalSeconds: Number(rows[0]?.critical_seconds ?? 480),
    readyDisplaySeconds: Number(rows[0]?.ready_display_seconds ?? 900),
    onlineRequiresPaid: Boolean(rows[0]?.online_requires_paid ?? false),
    posRequiresPaid: Boolean(rows[0]?.pos_requires_paid ?? false),
    inventoryTrigger: "ready"
  };
}

export async function getKitchenOperationsMetrics(
  locationId: string,
  sla: KitchenSla
): Promise<KitchenOperationsMetrics> {
  const sql = getPostgresSql();
  const rows = await sql<{
    orders_today: number;
    average_acceptance_seconds: string | number | null;
    average_cooking_seconds: string | number | null;
    average_total_seconds: string | number | null;
    median_total_seconds: string | number | null;
    p90_total_seconds: string | number | null;
    average_pickup_wait_seconds: string | number | null;
    sla_compliance_percent: string | number | null;
    throughput_last_hour: number;
  }[]>`
    with scoped as (
      select o.*
      from public.orders o
      join public.order_locations location on location.id = o.location_id
      where o.location_id = ${locationId}::uuid
        and (o.created_at at time zone location.timezone)::date =
            (now() at time zone location.timezone)::date
    ), cycle as (
      select *, extract(epoch from (ready_at - created_at)) as total_seconds
      from scoped
    )
    select
      count(*) filter (where kitchen_status <> 'cancelled')::integer as orders_today,
      avg(extract(epoch from (accepted_at - created_at)))
        filter (where accepted_at is not null) as average_acceptance_seconds,
      avg(extract(epoch from (ready_at - cooking_started_at)))
        filter (where ready_at is not null and cooking_started_at is not null) as average_cooking_seconds,
      avg(total_seconds) filter (where total_seconds >= 0) as average_total_seconds,
      percentile_cont(0.5) within group (order by total_seconds)
        filter (where total_seconds >= 0) as median_total_seconds,
      percentile_cont(0.9) within group (order by total_seconds)
        filter (where total_seconds >= 0) as p90_total_seconds,
      avg(extract(epoch from (handed_out_at - ready_at)))
        filter (where handed_out_at is not null and ready_at is not null) as average_pickup_wait_seconds,
      case
        when count(*) filter (where total_seconds >= 0) = 0 then null
        else 100.0 * count(*) filter (
          where total_seconds between 0 and ${sla.criticalSeconds}
        ) / count(*) filter (where total_seconds >= 0)
      end as sla_compliance_percent,
      count(*) filter (
        where ready_at >= now() - interval '1 hour'
          and kitchen_status <> 'cancelled'
      )::integer as throughput_last_hour
    from cycle
  `;
  const row = rows[0];
  const optionalNumber = (value: string | number | null | undefined) =>
    value === null || value === undefined ? null : Number(value);
  return {
    ordersToday: Number(row?.orders_today ?? 0),
    averageAcceptanceSeconds: optionalNumber(row?.average_acceptance_seconds),
    averageCookingSeconds: optionalNumber(row?.average_cooking_seconds),
    averageTotalSeconds: optionalNumber(row?.average_total_seconds),
    medianTotalSeconds: optionalNumber(row?.median_total_seconds),
    p90TotalSeconds: optionalNumber(row?.p90_total_seconds),
    averagePickupWaitSeconds: optionalNumber(row?.average_pickup_wait_seconds),
    slaCompliancePercent: optionalNumber(row?.sla_compliance_percent),
    throughputLastHour: Number(row?.throughput_last_hour ?? 0)
  };
}

export async function getOrderFlowQueue(params: {
  locationId: string;
  statuses?: KitchenStatus[];
  limit?: number;
}): Promise<OrderFlowOrder[]> {
  const statuses = params.statuses?.length
    ? params.statuses
    : ["new", "accepted", "cooking", "ready"] as KitchenStatus[];
  const limit = Math.min(250, Math.max(1, params.limit ?? 120));
  const sql = getPostgresSql();
  const orders = await sql<OrderRow[]>`
    select o.id, o.display_number, o.source, o.location_id, l.name as location_name,
      o.created_at, o.accepted_at, o.cooking_started_at, o.ready_at,
      o.handed_out_at, o.requested_at, o.kitchen_status, o.status,
      o.payment_status, o.fiscal_status, o.public_display_name,
      o.public_avatar_seed, o.public_avatar_config, o.delivery_type, o.fulfillment_mode,
      o.comment, o.address, o.total, staff.name as assigned_staff_name
    from public.orders o
    join public.order_locations l on l.id = o.location_id
    left join public.staff_users staff on staff.id = o.assigned_staff_id
    where o.location_id = ${params.locationId}::uuid
      and o.kitchen_status = any(${statuses}::text[])
    order by coalesce(o.requested_at, o.created_at), o.created_at
    limit ${limit}
  `;
  if (!orders.length) return [];
  const orderIds = orders.map((order) => order.id);
  const items = await sql<ItemRow[]>`
    select item.id, item.order_id, item.product_id, item.product_name,
      item.quantity, item.unit_price, item.line_total, product.allergens
    from public.order_items item
    left join public.products product on product.id = item.product_id
    where item.order_id = any(${orderIds}::uuid[])
    order by item.id
  `;
  const itemIds = items.map((item) => item.id);
  const modifiers = itemIds.length
    ? await sql<ModifierRow[]>`
        select id, order_item_id, ingredient_id, modifier_type, ingredient_name, quantity, unit
        from public.order_item_modifiers
        where order_item_id = any(${itemIds}::uuid[])
        order by created_at, id
      `
    : [];
  const modifiersByItem = new Map<string, OrderFlowModifier[]>();
  for (const row of modifiers) {
    modifiersByItem.set(row.order_item_id, [
      ...(modifiersByItem.get(row.order_item_id) ?? []),
      mapModifier(row)
    ]);
  }
  const productIds = Array.from(new Set(items.flatMap((item) => item.product_id ? [item.product_id] : [])));
  const recipeRows = productIds.length
    ? await sql<{
        id: string;
        product_id: string;
        ingredient_id: string;
        name: string;
        quantity: string | number;
        unit: string;
        sort_order: number;
        preparation_step: string | null;
        preparation_note: string | null;
        preparation_image_url: string | null;
        station: string | null;
        preparation_time_seconds: number | null;
      }[]>`
        select pi.id, pi.product_id, pi.ingredient_id, ingredient.name,
          pi.quantity, pi.unit, pi.sort_order, pi.preparation_step,
          pi.preparation_note, pi.preparation_image_url, pi.station,
          pi.preparation_time_seconds
        from public.product_ingredients pi
        join public.ingredients ingredient on ingredient.id = pi.ingredient_id
        where pi.product_id = any(${productIds}::uuid[])
        order by pi.product_id, pi.sort_order, ingredient.name
      `
    : [];
  const recipeByProduct = new Map<string, OrderRecipe["lines"]>();
  for (const line of recipeRows) {
    recipeByProduct.set(line.product_id, [
      ...(recipeByProduct.get(line.product_id) ?? []),
      {
        id: line.id,
        ingredientId: line.ingredient_id,
        name: line.name,
        quantity: Number(line.quantity),
        unit: line.unit,
        sortOrder: Number(line.sort_order),
        step: line.preparation_step,
        note: line.preparation_note,
        imageUrl: line.preparation_image_url,
        station: line.station,
        preparationTimeSeconds: line.preparation_time_seconds
      }
    ]);
  }
  const itemsByOrder = new Map<string, OrderFlowItem[]>();
  for (const row of items) {
    itemsByOrder.set(row.order_id, [
      ...(itemsByOrder.get(row.order_id) ?? []),
      mapItem(row, modifiersByItem.get(row.id) ?? [], row.product_id ? recipeByProduct.get(row.product_id) ?? [] : [])
    ]);
  }
  return orders.map((order) => mapOrder(order, itemsByOrder.get(order.id) ?? []));
}

export async function getOrderRecipe(params: {
  orderId: string;
  orderItemId: string;
}): Promise<OrderRecipe | null> {
  const sql = getPostgresSql();
  const items = await sql<{
    product_id: string | null;
    product_name: string;
    quantity: number;
    allergens: string[] | null;
  }[]>`
    select oi.product_id, oi.product_name, oi.quantity, p.allergens
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    where oi.id = ${params.orderItemId}::uuid
      and oi.order_id = ${params.orderId}::uuid
    limit 1
  `;
  const item = items[0];
  if (!item?.product_id) return null;
  const lines = await sql<{
    id: string;
    ingredient_id: string;
    name: string;
    quantity: string | number;
    unit: string;
    sort_order: number;
    preparation_step: string | null;
    preparation_note: string | null;
    preparation_image_url: string | null;
    station: string | null;
    preparation_time_seconds: number | null;
  }[]>`
    select pi.id, pi.ingredient_id, ingredient.name,
      pi.quantity, pi.unit, pi.sort_order, pi.preparation_step,
      pi.preparation_note, pi.preparation_image_url, pi.station,
      pi.preparation_time_seconds
    from public.product_ingredients pi
    join public.ingredients ingredient on ingredient.id = pi.ingredient_id
    where pi.product_id = ${item.product_id}::uuid
    order by pi.sort_order, ingredient.name
  `;
  return {
    productId: item.product_id,
    productName: item.product_name,
    allergens: item.allergens ?? [],
    quantity: Number(item.quantity),
    lines: lines.map((line) => ({
      id: line.id,
      ingredientId: line.ingredient_id,
      name: line.name,
      quantity: Number(line.quantity),
      unit: line.unit,
      sortOrder: Number(line.sort_order),
      step: line.preparation_step,
      note: line.preparation_note,
      imageUrl: line.preparation_image_url,
      station: line.station,
      preparationTimeSeconds: line.preparation_time_seconds
    }))
  };
}

export async function getOrderOutboxEvents(params: {
  afterId: number;
  locationId: string;
  limit?: number;
}) {
  const sql = getPostgresSql();
  const limit = Math.min(100, Math.max(1, params.limit ?? 50));
  return sql<{ id: number; event_type: string; aggregate_id: string; created_at: string }[]>`
    select event.id, event.event_type, event.aggregate_id, event.created_at
    from public.order_outbox event
    join public.orders order_row on order_row.id = event.aggregate_id
    where event.id > ${params.afterId}
      and order_row.location_id = ${params.locationId}::uuid
    order by event.id
    limit ${limit}
  `;
}

export async function getLatestOrderEventCursor(locationId: string) {
  const sql = getPostgresSql();
  const rows = await sql<{ id: string | number | null }[]>`
    select max(event.id) as id
    from public.order_outbox event
    join public.orders order_row on order_row.id = event.aggregate_id
    where order_row.location_id = ${locationId}::uuid
  `;
  return Number(rows[0]?.id ?? 0);
}
