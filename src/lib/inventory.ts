import "server-only";

import { getCurrentStaff } from "@/lib/admin-auth";
import { formatMissingTableError } from "@/lib/database/errors";
import { createDatabaseServerClient } from "@/lib/database/server";
import { getPostgresSql } from "@/lib/postgres/server";
import { getAdminIngredients, type Ingredient } from "./ingredients";

export type InventoryMovementType =
  | "receipt"
  | "sale"
  | "write_off"
  | "correction"
  | "return"
  | "production_consumption"
  | "production_output";

export type InventoryItem = {
  id: string;
  created_at: string;
  updated_at: string | null;
  ingredient_id: string;
  current_quantity: number;
  reserved_quantity: number;
  min_quantity: number;
  unit: "g" | "ml" | "pcs";
  location: string | null;
  is_active: boolean;
};

export type InventoryCard = {
  ingredient: Ingredient;
  item: InventoryItem | null;
  stock_value: number;
  status: "normal" | "low" | "empty" | "missing";
};

export type InventoryMovement = {
  id: string;
  created_at: string;
  ingredient_id: string | null;
  ingredient_name: string | null;
  order_id: string | null;
  product_id: string | null;
  production_run_id: string | null;
  movement_type: InventoryMovementType;
  quantity: number;
  unit: "g" | "ml" | "pcs";
  reason: string | null;
  comment: string | null;
  created_by: string;
};

function normalizeUnit(value: unknown): "g" | "ml" | "pcs" {
  return value === "ml" || value === "pcs" ? value : "g";
}

function normalizeInventoryItem(row: Record<string, unknown>): InventoryItem {
  return {
    id: String(row.id),
    created_at: String(row.created_at ?? ""),
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    ingredient_id: String(row.ingredient_id ?? ""),
    current_quantity: Number(row.current_quantity ?? 0),
    reserved_quantity: Number(row.reserved_quantity ?? 0),
    min_quantity: Number(row.min_quantity ?? 0),
    unit: normalizeUnit(row.unit),
    location: typeof row.location === "string" && row.location.length > 0 ? row.location : null,
    is_active: row.is_active !== false
  };
}

function normalizeMovement(row: Record<string, unknown>, ingredientName: string | null): InventoryMovement {
  const type = String(row.movement_type ?? "correction") as InventoryMovementType;

  return {
    id: String(row.id),
    created_at: String(row.created_at ?? ""),
    ingredient_id: row.ingredient_id ? String(row.ingredient_id) : null,
    ingredient_name: ingredientName,
    order_id: row.order_id ? String(row.order_id) : null,
    product_id: row.product_id ? String(row.product_id) : null,
    production_run_id: row.production_run_id ? String(row.production_run_id) : null,
    movement_type: type,
    quantity: Number(row.quantity ?? 0),
    unit: normalizeUnit(row.unit),
    reason: typeof row.reason === "string" && row.reason.length > 0 ? row.reason : null,
    comment: typeof row.comment === "string" && row.comment.length > 0 ? row.comment : null,
    created_by: String(row.created_by ?? "system")
  };
}

function getCardStatus(item: InventoryItem | null): InventoryCard["status"] {
  if (!item) {
    return "missing";
  }

  if (item.current_quantity <= 0) {
    return "empty";
  }

  if (item.min_quantity > 0 && item.current_quantity <= item.min_quantity) {
    return "low";
  }

  return "normal";
}

function inventoryTableError(message: string | null | undefined, table = "inventory_items") {
  return formatMissingTableError(message, table);
}

function hasGlobalInventoryAccess(staff: Awaited<ReturnType<typeof getCurrentStaff>>) {
  return Boolean(staff && (staff.legacy || staff.role === "owner" || staff.role === "admin"));
}

function canViewInventory(staff: Awaited<ReturnType<typeof getCurrentStaff>>) {
  return Boolean(staff && ["owner", "admin", "manager"].includes(staff.role));
}

async function countVisibleInventoryMovementsSince(createdAt: string, staff: NonNullable<Awaited<ReturnType<typeof getCurrentStaff>>>) {
  const sql = getPostgresSql();
  const unrestricted = hasGlobalInventoryAccess(staff);
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from public.inventory_movements movement
    where movement.created_at >= ${createdAt}::timestamptz
      and (
        ${unrestricted}::boolean
        or movement.order_id is null
        or exists (
          select 1
          from public.orders order_row
          join public.staff_location_access access
            on access.order_location_id = order_row.location_id
           and access.staff_id = ${staff.id}::uuid
          where order_row.id = movement.order_id
        )
      )
  `;
  return Number(row?.count ?? 0);
}

export function formatInventoryQuantity(value: number | null | undefined, unit: string | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  const label = ({ g: "г", kg: "кг", ml: "мл", l: "л", pcs: "шт." } as Record<string, string>)[unit ?? ""] ?? unit ?? "";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)} ${label}`.trim();
}

export async function getInventoryByIngredientIds(ingredientIds: string[]) {
  const database = createDatabaseServerClient();

  if (!database || !ingredientIds.length) {
    return {
      itemsByIngredient: new Map<string, InventoryItem>(),
      error: null as string | null,
      notConfigured: !database
    };
  }

  const { data, error } = await database
    .from("inventory_items")
    .select("id, created_at, updated_at, ingredient_id, current_quantity, reserved_quantity, min_quantity, unit, location, is_active")
    .in("ingredient_id", ingredientIds);

  const itemsByIngredient = new Map<string, InventoryItem>();

  for (const row of data ?? []) {
    const item = normalizeInventoryItem(row);
    itemsByIngredient.set(item.ingredient_id, item);
  }

  return {
    itemsByIngredient,
    error: inventoryTableError(error?.message),
    notConfigured: false
  };
}

export async function getInventoryCards() {
  const ingredientsResult = await getAdminIngredients();

  if (ingredientsResult.notConfigured || ingredientsResult.error) {
    return {
      cards: [] as InventoryCard[],
      movementsToday: 0,
      notConfigured: ingredientsResult.notConfigured,
      error: ingredientsResult.error
    };
  }

  const inventoryResult = await getInventoryByIngredientIds(ingredientsResult.ingredients.map((ingredient) => ingredient.id));
  const database = createDatabaseServerClient();
  let movementsToday = 0;

  if (database && !inventoryResult.error) {
    const staff = await getCurrentStaff();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    if (staff && canViewInventory(staff)) {
      try {
        movementsToday = await countVisibleInventoryMovementsSince(startOfDay.toISOString(), staff);
      } catch {
        movementsToday = 0;
      }
    }
  }

  const cards = ingredientsResult.ingredients.map((ingredient) => {
    const item = inventoryResult.itemsByIngredient.get(ingredient.id) ?? null;
    const stockValue = (item?.current_quantity ?? 0) * ingredient.cost_per_unit;

    return {
      ingredient,
      item,
      stock_value: stockValue,
      status: getCardStatus(item)
    } satisfies InventoryCard;
  });

  return {
    cards,
    movementsToday,
    notConfigured: inventoryResult.notConfigured,
    error: inventoryResult.error
  };
}

export async function getInventoryStockValue() {
  const result = await getInventoryCards();

  return {
    value: result.cards.reduce((sum, card) => sum + card.stock_value, 0),
    error: result.error,
    notConfigured: result.notConfigured
  };
}

export async function getInventoryMovements(filters?: { ingredientId?: string; movementType?: string }) {
  const database = createDatabaseServerClient();

  if (!database) {
    return {
      movements: [] as InventoryMovement[],
      ingredients: [] as Ingredient[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const staff = await getCurrentStaff();
  if (!staff || !canViewInventory(staff)) {
    return {
      movements: [] as InventoryMovement[],
      ingredients: [] as Ingredient[],
      notConfigured: false,
      error: "Недостаточно прав для просмотра движений склада."
    };
  }

  const ingredientsResult = await getAdminIngredients();
  const ingredientNames = new Map(ingredientsResult.ingredients.map((ingredient) => [ingredient.id, ingredient.name]));
  const sql = getPostgresSql();
  const unrestricted = hasGlobalInventoryAccess(staff);
  let data: Record<string, unknown>[] = [];
  let error: { message?: string } | null = null;
  try {
    data = await sql<Record<string, unknown>[]>`
      select movement.id, movement.created_at, movement.ingredient_id, movement.order_id,
        movement.product_id, movement.production_run_id, movement.movement_type,
        movement.quantity, movement.unit, movement.reason, movement.comment, movement.created_by
      from public.inventory_movements movement
      where (${filters?.ingredientId ?? null}::text is null or movement.ingredient_id::text = ${filters?.ingredientId ?? null}::text)
        and (${filters?.movementType ?? null}::text is null or movement.movement_type = ${filters?.movementType ?? null}::text)
        and (
          ${unrestricted}::boolean
          or movement.order_id is null
          or exists (
            select 1
            from public.orders order_row
            join public.staff_location_access access
              on access.order_location_id = order_row.location_id
             and access.staff_id = ${staff.id}::uuid
            where order_row.id = movement.order_id
          )
        )
      order by movement.created_at desc
      limit 100
    `;
  } catch (queryError) {
    error = { message: queryError instanceof Error ? queryError.message : "Query failed" };
  }

  return {
    movements: data.map((row) => normalizeMovement(row, ingredientNames.get(String(row.ingredient_id)) ?? null)),
    ingredients: ingredientsResult.ingredients,
    notConfigured: false,
    error: inventoryTableError(error?.message, "inventory_movements")
  };
}

export async function ensureInventoryItem(ingredientId: string, defaults?: { currentQuantity?: number; location?: string | null; minQuantity?: number }) {
  const database = createDatabaseServerClient();

  if (!database) {
    return { ok: false as const, message: "База данных не подключена." };
  }

  const { data: ingredient, error: ingredientError } = await database
    .from("ingredients")
    .select("id, unit")
    .eq("id", ingredientId)
    .maybeSingle();

  if (ingredientError || !ingredient) {
    return { ok: false as const, message: ingredientError?.message ?? "Ингредиент не найден." };
  }

  const { error } = await database.from("inventory_items").upsert(
    {
      ingredient_id: ingredientId,
      location: defaults?.location || null,
      min_quantity: defaults?.minQuantity ?? 0,
      unit: normalizeUnit(ingredient.unit)
    },
    { onConflict: "ingredient_id" }
  );

  if (error) {
    return { ok: false as const, message: inventoryTableError(error.message) ?? error.message };
  }

  if ((defaults?.currentQuantity ?? 0) > 0) {
    return correctInventory({
      comment: "Начальный остаток складской карточки",
      ingredientId,
      newQuantity: defaults?.currentQuantity ?? 0
    });
  }

  return { ok: true as const };
}

async function getInventoryOperationBase(ingredientId: string) {
  const database = createDatabaseServerClient();

  if (!database) {
    return { ok: false as const, message: "База данных не подключена." };
  }

  const { data: ingredient, error: ingredientError } = await database
    .from("ingredients")
    .select("id, name, unit, cost_per_unit")
    .eq("id", ingredientId)
    .maybeSingle();

  if (ingredientError || !ingredient) {
    return { ok: false as const, message: ingredientError?.message ?? "Ингредиент не найден." };
  }

  const { data: item, error: itemError } = await database
    .from("inventory_items")
    .select("id, ingredient_id, current_quantity, reserved_quantity, min_quantity, unit, location, is_active")
    .eq("ingredient_id", ingredientId)
    .maybeSingle();

  if (itemError) {
    return { ok: false as const, message: inventoryTableError(itemError.message) ?? itemError.message };
  }

  return {
    ok: true as const,
    ingredient: {
      id: String(ingredient.id),
      name: String(ingredient.name),
      unit: normalizeUnit(ingredient.unit),
      cost_per_unit: Number(ingredient.cost_per_unit ?? 0)
    },
    item: item ? normalizeInventoryItem({ ...item, created_at: "", updated_at: null }) : null,
    database
  };
}

export async function updateInventoryCard(params: {
  currentQuantity?: number;
  ingredientId: string;
  location?: string | null;
  minQuantity: number;
}) {
  const base = await getInventoryOperationBase(params.ingredientId);

  if (!base.ok) {
    return base;
  }

  const { error } = await base.database.from("inventory_items").upsert(
    {
      ingredient_id: params.ingredientId,
      location: params.location || null,
      min_quantity: params.minQuantity,
      unit: base.ingredient.unit
    },
    { onConflict: "ingredient_id" }
  );

  if (error) {
    return { ok: false as const, message: inventoryTableError(error.message) ?? error.message };
  }

  if (
    params.currentQuantity !== undefined &&
    params.currentQuantity !== (base.item?.current_quantity ?? 0)
  ) {
    return correctInventory({
      comment: "Корректировка из складской карточки",
      ingredientId: params.ingredientId,
      newQuantity: params.currentQuantity
    });
  }

  return { ok: true as const };
}

export async function receiptInventory(params: {
  comment?: string | null;
  ingredientId: string;
  packagePrice?: number | null;
  quantity: number;
  updateCostPerUnit?: boolean;
}) {
  if (params.quantity <= 0) {
    return { ok: false as const, message: "Укажите количество прихода больше нуля." };
  }

  const database = createDatabaseServerClient();
  if (!database) return { ok: false as const, message: "База данных не подключена." };
  const { error } = await database.rpc("apply_inventory_movement_atomic", {
    p_comment: params.comment || null,
    p_created_by: "admin",
    p_ingredient_id: params.ingredientId,
    p_movement_type: "receipt",
    p_new_quantity: null,
    p_package_price: params.packagePrice ?? null,
    p_quantity: params.quantity,
    p_reason: "Приход",
    p_update_cost: Boolean(params.updateCostPerUnit)
  });

  if (error) {
    return { ok: false as const, message: error.code === "P0001" ? error.message : "Не удалось оформить приход." };
  }

  return { ok: true as const };
}

export async function writeOffInventory(params: {
  comment?: string | null;
  ingredientId: string;
  quantity: number;
  reason: string;
}) {
  if (params.quantity <= 0) {
    return { ok: false as const, message: "Укажите количество списания больше нуля." };
  }

  const database = createDatabaseServerClient();
  if (!database) return { ok: false as const, message: "База данных не подключена." };
  const { error } = await database.rpc("apply_inventory_movement_atomic", {
    p_comment: params.comment || null,
    p_created_by: "admin",
    p_ingredient_id: params.ingredientId,
    p_movement_type: "write_off",
    p_new_quantity: null,
    p_package_price: null,
    p_quantity: params.quantity,
    p_reason: params.reason || "Списание",
    p_update_cost: false
  });

  if (error) {
    return { ok: false as const, message: error.code === "P0001" ? error.message : "Не удалось оформить списание." };
  }

  return { ok: true as const };
}

export async function correctInventory(params: {
  comment?: string | null;
  ingredientId: string;
  newQuantity: number;
}) {
  if (params.newQuantity < 0) {
    return { ok: false as const, message: "Остаток не может быть отрицательным." };
  }

  const database = createDatabaseServerClient();
  if (!database) return { ok: false as const, message: "База данных не подключена." };
  const { error } = await database.rpc("apply_inventory_movement_atomic", {
    p_comment: params.comment || null,
    p_created_by: "admin",
    p_ingredient_id: params.ingredientId,
    p_movement_type: "correction",
    p_new_quantity: params.newQuantity,
    p_package_price: null,
    p_quantity: null,
    p_reason: "Инвентаризация",
    p_update_cost: false
  });

  if (error) {
    return { ok: false as const, message: error.code === "P0001" ? error.message : "Не удалось сохранить корректировку." };
  }

  return { ok: true as const };
}
