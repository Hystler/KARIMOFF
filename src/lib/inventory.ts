import "server-only";

import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

type DeductionLine = {
  ingredient_id: string;
  ingredient_name: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit: "g" | "ml" | "pcs";
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
  return formatMissingTableError(message, table, "supabase/inventory.sql");
}

export function formatInventoryQuantity(value: number | null | undefined, unit: string | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)} ${unit ?? ""}`.trim();
}

export async function getInventoryByIngredientIds(ingredientIds: string[]) {
  const supabase = createSupabaseServerClient();

  if (!supabase || !ingredientIds.length) {
    return {
      itemsByIngredient: new Map<string, InventoryItem>(),
      error: null as string | null,
      notConfigured: !supabase
    };
  }

  const { data, error } = await supabase
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
  const supabase = createSupabaseServerClient();
  let movementsToday = 0;

  if (supabase && !inventoryResult.error) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count } = await supabase
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
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      movements: [] as InventoryMovement[],
      ingredients: [] as Ingredient[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const ingredientsResult = await getAdminIngredients();
  const ingredientNames = new Map(ingredientsResult.ingredients.map((ingredient) => [ingredient.id, ingredient.name]));
  let query = supabase
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
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { ok: false as const, message: "Supabase не подключён." };
  }

  const { data: ingredient, error: ingredientError } = await supabase
    .from("ingredients")
    .select("id, unit")
    .eq("id", ingredientId)
    .maybeSingle();

  if (ingredientError || !ingredient) {
    return { ok: false as const, message: ingredientError?.message ?? "Ингредиент не найден." };
  }

  const { error } = await supabase.from("inventory_items").upsert(
    {
      ingredient_id: ingredientId,
      current_quantity: defaults?.currentQuantity ?? 0,
      location: defaults?.location || null,
      min_quantity: defaults?.minQuantity ?? 0,
      unit: normalizeUnit(ingredient.unit)
    },
    { onConflict: "ingredient_id" }
  );

  if (error) {
    return { ok: false as const, message: inventoryTableError(error.message) ?? error.message };
  }

  return { ok: true as const };
}

async function getInventoryOperationBase(ingredientId: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { ok: false as const, message: "Supabase не подключён." };
  }

  const { data: ingredient, error: ingredientError } = await supabase
    .from("ingredients")
    .select("id, name, unit, cost_per_unit")
    .eq("id", ingredientId)
    .maybeSingle();

  if (ingredientError || !ingredient) {
    return { ok: false as const, message: ingredientError?.message ?? "Ингредиент не найден." };
  }

  const { data: item, error: itemError } = await supabase
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
    supabase
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

  const currentQuantity = params.currentQuantity ?? base.item?.current_quantity ?? 0;
  const { error } = await base.supabase.from("inventory_items").upsert(
    {
      current_quantity: currentQuantity,
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

  return { ok: true as const };
}

export async function receiptInventory(params: {
  comment?: string | null;
  ingredientId: string;
  packagePrice?: number | null;
  quantity: number;
  updateCostPerUnit?: boolean;
}) {
  const base = await getInventoryOperationBase(params.ingredientId);

  if (!base.ok) {
    return base;
  }

  if (params.quantity <= 0) {
    return { ok: false as const, message: "Укажите количество прихода больше нуля." };
  }

  if (!base.item) {
    const created = await ensureInventoryItem(params.ingredientId);
    if (!created.ok) {
      return created;
    }
  }

  const currentQuantity = base.item?.current_quantity ?? 0;
  const nextQuantity = currentQuantity + params.quantity;
  const { error: updateError } = await base.supabase
    .from("inventory_items")
    .update({ current_quantity: nextQuantity, unit: base.ingredient.unit })
    .eq("ingredient_id", params.ingredientId);

  if (updateError) {
    return { ok: false as const, message: inventoryTableError(updateError.message) ?? updateError.message };
  }

  if (params.updateCostPerUnit && params.packagePrice && params.quantity > 0) {
    await base.supabase.from("ingredients").update({ cost_per_unit: params.packagePrice / params.quantity }).eq("id", params.ingredientId);
  }

  const { error: movementError } = await base.supabase.from("inventory_movements").insert({
    comment: params.comment || null,
    created_by: "admin",
    ingredient_id: params.ingredientId,
    movement_type: "receipt",
    quantity: params.quantity,
    reason: "Приход",
    unit: base.ingredient.unit
  });

  if (movementError) {
    return { ok: false as const, message: inventoryTableError(movementError.message, "inventory_movements") ?? movementError.message };
  }

  return { ok: true as const };
}

export async function writeOffInventory(params: {
  comment?: string | null;
  ingredientId: string;
  quantity: number;
  reason: string;
}) {
  const base = await getInventoryOperationBase(params.ingredientId);

  if (!base.ok) {
    return base;
  }

  if (!base.item) {
    return { ok: false as const, message: "Складская карточка ингредиента не создана." };
  }

  if (params.quantity <= 0) {
    return { ok: false as const, message: "Укажите количество списания больше нуля." };
  }

  if (base.item.current_quantity < params.quantity) {
    return {
      ok: false as const,
      message: `Недостаточно остатка: доступно ${formatInventoryQuantity(base.item.current_quantity, base.item.unit)}.`
    };
  }

  const nextQuantity = base.item.current_quantity - params.quantity;
  const { error: updateError } = await base.supabase
    .from("inventory_items")
    .update({ current_quantity: nextQuantity })
    .eq("ingredient_id", params.ingredientId);

  if (updateError) {
    return { ok: false as const, message: inventoryTableError(updateError.message) ?? updateError.message };
  }

  const { error: movementError } = await base.supabase.from("inventory_movements").insert({
    comment: params.comment || null,
    created_by: "admin",
    ingredient_id: params.ingredientId,
    movement_type: "write_off",
    quantity: -params.quantity,
    reason: params.reason || "Списание",
    unit: base.item.unit
  });

  if (movementError) {
    return { ok: false as const, message: inventoryTableError(movementError.message, "inventory_movements") ?? movementError.message };
  }

  return { ok: true as const };
}

export async function correctInventory(params: {
  comment?: string | null;
  ingredientId: string;
  newQuantity: number;
}) {
  const base = await getInventoryOperationBase(params.ingredientId);

  if (!base.ok) {
    return base;
  }

  if (params.newQuantity < 0) {
    return { ok: false as const, message: "Остаток не может быть отрицательным." };
  }

  if (!base.item) {
    const created = await ensureInventoryItem(params.ingredientId, { currentQuantity: 0 });
    if (!created.ok) {
      return created;
    }
  }

  const currentQuantity = base.item?.current_quantity ?? 0;
  const difference = params.newQuantity - currentQuantity;
  const { error: updateError } = await base.supabase
    .from("inventory_items")
    .update({ current_quantity: params.newQuantity, unit: base.ingredient.unit })
    .eq("ingredient_id", params.ingredientId);

  if (updateError) {
    return { ok: false as const, message: inventoryTableError(updateError.message) ?? updateError.message };
  }

  const { error: movementError } = await base.supabase.from("inventory_movements").insert({
    comment: params.comment || null,
    created_by: "admin",
    ingredient_id: params.ingredientId,
    movement_type: "correction",
    quantity: difference,
    reason: "Инвентаризация",
    unit: base.ingredient.unit
  });

  if (movementError) {
    return { ok: false as const, message: inventoryTableError(movementError.message, "inventory_movements") ?? movementError.message };
  }

  return { ok: true as const };
}

export async function deductInventoryForOrder(orderId: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { ok: false as const, message: "Supabase не подключён.", warnings: [] as string[] };
  }

  const { data: existingDeduction, error: deductionCheckError } = await supabase
    .from("order_inventory_deductions")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();

  if (deductionCheckError) {
    return {
      ok: false as const,
      message: inventoryTableError(deductionCheckError.message, "order_inventory_deductions") ?? deductionCheckError.message,
      warnings: [] as string[]
    };
  }

  if (existingDeduction) {
    return { ok: true as const, warnings: ["Склад уже списан по этому заказу."] };
  }

  const { data: orderItems, error: orderItemsError } = await supabase
    .from("order_items")
    .select("id, product_id, product_name, quantity")
    .eq("order_id", orderId);

  if (orderItemsError) {
    return { ok: false as const, message: orderItemsError.message, warnings: [] as string[] };
  }

  const productIds = Array.from(
    new Set((orderItems ?? []).map((item) => (item.product_id ? String(item.product_id) : null)).filter(Boolean) as string[])
  );
  const warnings: string[] = [];

  if (!productIds.length) {
    warnings.push("У товаров заказа нет product_id, склад не списан.");
    await supabase.from("order_inventory_deductions").insert({ order_id: orderId, status: "deducted" });
    return { ok: true as const, warnings };
  }

  const { data: compositionRows, error: compositionError } = await supabase
    .from("product_ingredients")
    .select("product_id, ingredient_id, quantity, unit")
    .in("product_id", productIds);

  if (compositionError) {
    return {
      ok: false as const,
      message: formatMissingTableError(compositionError.message, "product_ingredients", "supabase/ingredients.sql") ?? compositionError.message,
      warnings
    };
  }

  const compositionByProduct = new Map<string, Array<{ ingredient_id: string; quantity: number; unit: "g" | "ml" | "pcs" }>>();

  for (const row of compositionRows ?? []) {
    const productId = String(row.product_id);
    compositionByProduct.set(productId, [
      ...(compositionByProduct.get(productId) ?? []),
      {
        ingredient_id: String(row.ingredient_id),
        quantity: Number(row.quantity ?? 0),
        unit: normalizeUnit(row.unit)
      }
    ]);
  }

  const deductionLines: DeductionLine[] = [];

  for (const item of orderItems ?? []) {
    const productId = item.product_id ? String(item.product_id) : null;
    const productName = String(item.product_name ?? "Товар");
    const orderQuantity = Number(item.quantity ?? 0);

    if (!productId) {
      warnings.push(`У товара не задан product_id, склад не списан: ${productName}`);
      continue;
    }

    const lines = compositionByProduct.get(productId) ?? [];

    if (!lines.length) {
      warnings.push(`У товара не задан состав, склад не списан: ${productName}`);
      continue;
    }

    for (const line of lines) {
      deductionLines.push({
        ingredient_id: line.ingredient_id,
        ingredient_name: "",
        product_id: productId,
        product_name: productName,
        quantity: line.quantity * orderQuantity,
        unit: line.unit
      });
    }
  }

  if (!deductionLines.length) {
    await supabase.from("order_inventory_deductions").insert({ order_id: orderId, status: "deducted" });
    return { ok: true as const, warnings };
  }

  const ingredientIds = Array.from(new Set(deductionLines.map((line) => line.ingredient_id)));
  const { data: ingredientsData, error: ingredientsError } = await supabase
    .from("ingredients")
    .select("id, name, unit")
    .in("id", ingredientIds);

  if (ingredientsError) {
    return { ok: false as const, message: ingredientsError.message, warnings };
  }

  const ingredientMeta = new Map(
    (ingredientsData ?? []).map((ingredient) => [
      String(ingredient.id),
      { name: String(ingredient.name ?? "Ингредиент"), unit: normalizeUnit(ingredient.unit) }
    ])
  );
  const { data: inventoryRows, error: inventoryError } = await supabase
    .from("inventory_items")
    .select("ingredient_id, current_quantity, unit")
    .in("ingredient_id", ingredientIds);

  if (inventoryError) {
    return { ok: false as const, message: inventoryTableError(inventoryError.message) ?? inventoryError.message, warnings };
  }

  const inventoryByIngredient = new Map(
    (inventoryRows ?? []).map((row) => [
      String(row.ingredient_id),
      { current_quantity: Number(row.current_quantity ?? 0), unit: normalizeUnit(row.unit) }
    ])
  );
  const requiredByIngredient = new Map<string, { quantity: number; unit: "g" | "ml" | "pcs" }>();

  for (const line of deductionLines) {
    const current = requiredByIngredient.get(line.ingredient_id);
    requiredByIngredient.set(line.ingredient_id, {
      quantity: (current?.quantity ?? 0) + line.quantity,
      unit: ingredientMeta.get(line.ingredient_id)?.unit ?? line.unit
    });
  }

  const deficits = Array.from(requiredByIngredient.entries())
    .map(([ingredientId, requirement]) => {
      const available = inventoryByIngredient.get(ingredientId)?.current_quantity ?? 0;
      return { ingredientId, required: requirement.quantity, available, unit: requirement.unit };
    })
    .filter((item) => item.required > item.available);

  if (deficits.length) {
    return {
      ok: false as const,
      message: `Недостаточно остатков:\n${deficits
        .map((item) => {
          const name = ingredientMeta.get(item.ingredientId)?.name ?? "Ингредиент";
          return `— ${name}: нужно ${formatInventoryQuantity(item.required, item.unit)}, доступно ${formatInventoryQuantity(item.available, item.unit)}`;
        })
        .join("\n")}`,
      warnings
    };
  }

  for (const [ingredientId, requirement] of requiredByIngredient.entries()) {
    const current = inventoryByIngredient.get(ingredientId)?.current_quantity ?? 0;
    const { error } = await supabase
      .from("inventory_items")
      .update({ current_quantity: current - requirement.quantity })
      .eq("ingredient_id", ingredientId);

    if (error) {
      return { ok: false as const, message: error.message, warnings };
    }
  }

  const movementRows = deductionLines.map((line) => ({
    comment: `Автосписание по заказу: ${line.product_name}`,
    created_by: "system",
    ingredient_id: line.ingredient_id,
    movement_type: "sale",
    order_id: orderId,
    product_id: line.product_id,
    quantity: -line.quantity,
    reason: "Автосписание по заказу",
    unit: ingredientMeta.get(line.ingredient_id)?.unit ?? line.unit
  }));
  const { error: movementsError } = await supabase.from("inventory_movements").insert(movementRows);

  if (movementsError) {
    return { ok: false as const, message: movementsError.message, warnings };
  }

  const { error: deductionError } = await supabase.from("order_inventory_deductions").insert({
    order_id: orderId,
    status: "deducted"
  });

  if (deductionError) {
    return { ok: false as const, message: deductionError.message, warnings };
  }

  return { ok: true as const, warnings };
}
