import "server-only";

import { formatMissingTableError } from "@/lib/database/errors";
import { createDatabaseServerClient } from "@/lib/database/server";
import { getAdminIngredients, type Ingredient } from "./ingredients";

export type InventoryMovementType = "receipt" | "sale" | "write_off" | "correction" | "return";

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

export function formatInventoryQuantity(value: number | null | undefined, unit: string | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)} ${unit ?? ""}`.trim();
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
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count } = await database
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfDay.toISOString());
    movementsToday = count ?? 0;
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

  const ingredientsResult = await getAdminIngredients();
  const ingredientNames = new Map(ingredientsResult.ingredients.map((ingredient) => [ingredient.id, ingredient.name]));
  let query = database
    .from("inventory_movements")
    .select("id, created_at, ingredient_id, order_id, product_id, movement_type, quantity, unit, reason, comment, created_by")
    .order("created_at", { ascending: false })
    .limit(100);

  if (filters?.ingredientId) {
    query = query.eq("ingredient_id", filters.ingredientId);
  }

  if (filters?.movementType) {
    query = query.eq("movement_type", filters.movementType);
  }

  const { data, error } = await query;

  return {
    movements: (data ?? []).map((row) => normalizeMovement(row, ingredientNames.get(String(row.ingredient_id)) ?? null)),
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
