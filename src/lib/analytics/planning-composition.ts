import { foodCostIdentityRows } from "./evotor-food-cost-identities";
import type { PlanningComponent, PlanningRecipe, PlanningSale } from "./planning-math";

export type PlanningProduct = { id: string; slug: string; name: string; active: boolean };
export type PlanningOption = {
  productId: string; groupName: string; modifierType: string | null; ingredientId: string | null;
  replacementIngredientId: string | null; quantity: number | null; unit: string | null;
};
export type PlanningPosition = {
  productId: string | null; name: string; weekday: number; quantity: number; revenue: number;
  source: string; mappingStatus: string; sku: string | null; storeId: string | null;
  receiptName: string | null; closedAt: string | null; compound: boolean;
  snapshot: PlanningComponent[];
};

export function resolvePlanningSales(input: {
  positions: PlanningPosition[]; products: PlanningProduct[]; recipes: PlanningRecipe[]; options: PlanningOption[];
}): PlanningSale[] {
  const products = new Map(input.products.map((p) => [p.id, p]));
  const bySlug = new Map(input.products.map((p) => [p.slug, p]));
  const identities = new Map(foodCostIdentityRows().map((rule) => [`${rule.store_id}:${rule.sku}`, rule]));
  const recipes = new Map<string, PlanningRecipe[]>();
  const options = new Map<string, PlanningOption[]>();
  for (const row of input.recipes) recipes.set(row.productId, [...(recipes.get(row.productId) ?? []), row]);
  for (const row of input.options) options.set(row.productId, [...(options.get(row.productId) ?? []), row]);

  return input.positions.map((position) => {
    let product = position.productId ? products.get(position.productId) : undefined;
    let composition: PlanningComponent[] = [];
    let compositionSource = "Не подтверждён";
    let issue: string | null = null;
    const fail = (reason: string) => { issue = reason; };
    if (position.source === "web") {
      // Usage snapshots already contain replacements, removals, extras and waste.
      composition = position.snapshot.map((line) => ({ ...line, wasteIncluded: true }));
      compositionSource = "Снимок заказа";
      if (!composition.length) fail("Нет исторического снимка состава");
    } else if (position.source !== "pos_evotor") {
      fail("Неизвестный источник продажи");
    } else if (position.compound) {
      fail("Не подтверждён состав вложенных позиций или модификаций чека");
    } else if (position.mappingStatus === "rejected") {
      fail("Сопоставление отклонено");
    } else {
      const identity = identities.get(`${position.storeId}:${position.sku}`);
      if (identity) {
        const proof = position.receiptName !== null && identity.names.includes(position.receiptName.trim().toLocaleLowerCase("ru-RU"))
          && position.closedAt !== null && new Date(position.closedAt).getTime() >= new Date(identity.valid_from).getTime();
        if (!proof) fail("SKU не прошёл проверку названия или периода действия");
        else if (identity.kind === "component") {
          if (position.productId) fail("Конфликт SKU добавки с сопоставленным товаром");
          else {
            composition = [{ ingredientId: identity.ingredient_id!, quantity: identity.quantity!, unit: identity.unit! }];
            compositionSource = "SKU добавки";
          }
        } else {
          const identified = bySlug.get(identity.product_slug!);
          const confirmed = position.mappingStatus === "confirmed" && product?.id === identified?.id && identified !== undefined;
          if (!identified || (position.productId && position.productId !== identified.id)) fail("Конфликт SKU с каталогом");
          else {
            product = identified;
            const recipe = recipes.get(product.id) ?? [];
            const variants = options.get(product.id) ?? [];
            if (identity.kind === "recipe") {
              if (variants.some((o) => o.modifierType === "replace")) fail("Не подтверждён вариант состава");
              else { composition = recipe; compositionSource = "SKU и техкарта"; }
            } else if (!confirmed) fail("Нет подтверждённого сопоставления варианта SKU");
            else if (identity.kind === "portion") {
              const option = variants.some((o) => o.groupName === "Размер порции" && o.modifierType === "replace"
                && (o.replacementIngredientId ?? o.ingredientId) === identity.ingredient_id
                && o.quantity === identity.quantity && o.unit === identity.unit);
              const onlyComponent = recipe.some((r) => r.ingredientId === identity.ingredient_id && r.unit === identity.unit)
                && !recipe.some((r) => r.ingredientId !== identity.ingredient_id && r.quantity !== 0);
              if (!option || !onlyComponent) fail("Порция SKU не совпадает с подтверждённой техкартой");
              else {
                composition = [{ ingredientId: identity.ingredient_id!, quantity: identity.quantity!, unit: identity.unit! }];
                compositionSource = "SKU порции";
              }
            } else if (identity.kind === "replacement") {
              const original = recipe.filter((r) => r.ingredientId === identity.original_ingredient_id);
              const option = variants.some((o) => o.modifierType === "replace" && o.ingredientId === identity.original_ingredient_id
                && o.replacementIngredientId === identity.ingredient_id && o.quantity === identity.quantity && o.unit === identity.unit);
              if (!option || original.length !== 1 || !Number.isFinite(original[0].quantity)
                || !(original[0].quantity >= 0) || original[0].unit !== identity.unit) fail("Замена SKU не совпадает с подтверждённой техкартой");
              else {
                composition = [...recipe.filter((r) => r.ingredientId !== identity.original_ingredient_id),
                  { ingredientId: identity.ingredient_id!, quantity: identity.quantity!, unit: identity.unit! }];
                compositionSource = "SKU замены";
              }
            }
          }
        }
      } else if (position.mappingStatus !== "confirmed" || !product) fail("Нет подтверждённого SKU или сопоставления");
      else if ((options.get(product.id) ?? []).some((o) => o.groupName === "Размер порции" || o.modifierType === "replace")) {
        fail("Неизвестный размер или замена: нужен подтверждённый SKU");
      } else { composition = recipes.get(product.id) ?? []; compositionSource = "Подтверждённая базовая техкарта"; }
    }
    return {
      productId: product?.id ?? null, name: compositionSource.startsWith("SKU") ? position.receiptName ?? position.name : position.name,
      weekday: position.weekday, quantity: position.quantity, revenue: position.revenue,
      active: compositionSource === "SKU добавки" || Boolean(product?.active), recipeIssue: issue,
      key: position.source === "pos_evotor" ? `pos:${position.storeId}:${position.sku ?? position.name}` : `web:${position.productId ?? position.name}`,
      sku: position.source === "pos_evotor" ? position.sku : null, mappingStatus: position.mappingStatus,
      composition, compositionSource, baseRecipePresent: product ? (recipes.get(product.id) ?? []).some((line) => line.quantity > 0) : false
    };
  });
}
