import type { Product } from "@/lib/product-types";

export type PosCartCustomization = {
  removedIngredientIds: string[];
  extras: Array<{ ingredientId: string; quantity: number }>;
  modifierOptionIds: string[];
  note: string;
};

export type PosCartLine = {
  lineId: string;
  product: Product;
  quantity: number;
  customization: PosCartCustomization;
};

function sorted(values: string[]) {
  return [...new Set(values)].sort();
}

export function defaultPosCustomization(product: Product): PosCartCustomization {
  return {
    removedIngredientIds: [],
    extras: [],
    modifierOptionIds: sorted(
      (product.modifier_groups ?? []).flatMap((group) =>
        group.options.filter((option) => option.is_default).map((option) => option.id)
      )
    ),
    note: ""
  };
}

export function canQuickAddProduct(product: Product) {
  const defaults = new Set(defaultPosCustomization(product).modifierOptionIds);
  return (product.modifier_groups ?? []).every((group) => {
    const selected = group.options.filter((option) => defaults.has(option.id)).length;
    return selected >= group.min_selections && selected <= group.max_selections;
  });
}

export function posCustomizationKey(customization: PosCartCustomization) {
  const extras = [...customization.extras]
    .filter((extra) => extra.quantity > 0)
    .sort((left, right) => left.ingredientId.localeCompare(right.ingredientId))
    .map((extra) => `${extra.ingredientId}:${extra.quantity}`)
    .join(",");
  return [
    sorted(customization.removedIngredientIds).join(","),
    extras,
    sorted(customization.modifierOptionIds).join(","),
    customization.note.trim()
  ].join("|");
}

export function getPosLineUnitPrice(line: PosCartLine) {
  const ingredientOptions = new Map(
    (line.product.modifier_options ?? []).map((option) => [option.ingredient_id, option])
  );
  const groupOptions = new Map(
    (line.product.modifier_groups ?? []).flatMap((group) =>
      group.options.map((option) => [option.id, option] as const)
    )
  );
  const extrasTotal = line.customization.extras.reduce((sum, extra) => {
    const option = ingredientOptions.get(extra.ingredientId);
    return sum + (option?.extra_price ?? 0) * extra.quantity;
  }, 0);
  const groupsTotal = line.customization.modifierOptionIds.reduce(
    (sum, optionId) => sum + (groupOptions.get(optionId)?.price_delta ?? 0),
    0
  );
  return line.product.price + extrasTotal + groupsTotal;
}

export function addPosCartLine(
  lines: PosCartLine[],
  product: Product,
  customization = defaultPosCustomization(product),
  quantity = 1,
  lineId = crypto.randomUUID()
) {
  const key = posCustomizationKey(customization);
  const existing = lines.find(
    (line) => line.product.id === product.id && posCustomizationKey(line.customization) === key
  );
  if (existing) {
    return lines.map((line) =>
      line.lineId === existing.lineId
        ? { ...line, quantity: Math.min(20, line.quantity + quantity) }
        : line
    );
  }
  return [
    ...lines,
    {
      lineId,
      product,
      quantity: Math.max(1, Math.min(20, quantity)),
      customization: {
        removedIngredientIds: sorted(customization.removedIngredientIds),
        extras: customization.extras.filter((extra) => extra.quantity > 0),
        modifierOptionIds: sorted(customization.modifierOptionIds),
        note: customization.note.trim()
      }
    }
  ];
}

export function serializePosCart(lines: PosCartLine[]) {
  return lines.map((line) => ({
    product_id: line.product.id,
    quantity: line.quantity,
    removed_ingredient_ids: line.customization.removedIngredientIds,
    extras: line.customization.extras.map((extra) => ({
      ingredient_id: extra.ingredientId,
      quantity: extra.quantity
    })),
    modifier_option_ids: line.customization.modifierOptionIds,
    note: line.customization.note
  }));
}
