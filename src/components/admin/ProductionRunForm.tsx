"use client";

import { Factory } from "lucide-react";
import { useState } from "react";
import type { ProductionRecipeView } from "@/lib/production";

export function ProductionRunForm({
  action,
  recipes
}: {
  action: (formData: FormData) => void | Promise<void>;
  recipes: ProductionRecipeView[];
}) {
  const activeRecipes = recipes.filter((recipe) => recipe.is_active);
  const [recipeId, setRecipeId] = useState(activeRecipes[0]?.id ?? "");
  const recipe = activeRecipes.find((item) => item.id === recipeId);
  const [outputQuantity, setOutputQuantity] = useState(recipe?.output_quantity ?? 0);

  function selectRecipe(id: string) {
    const next = activeRecipes.find((item) => item.id === id);
    setRecipeId(id);
    setOutputQuantity(next?.output_quantity ?? 0);
  }

  return (
    <form action={action} className="admin-card p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-karimoff-orange/10 text-karimoff-orange"><Factory size={22} /></span>
        <div>
          <p className="admin-eyebrow">Фактическая партия</p>
          <h2 className="mt-2 text-xl font-black">Зафиксировать выпуск</h2>
          <p className="mt-2 text-sm leading-6 text-karimoff-muted">Сырьё спишется со склада, полуфабрикат поступит на остаток, а его себестоимость обновится для food cost.</p>
        </div>
      </div>

      {activeRecipes.length ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="admin-field sm:col-span-2">
            Производственная карта
            <select name="recipe_id" value={recipeId} onChange={(event) => selectRecipe(event.target.value)}>
              {activeRecipes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="admin-field">
            Количество партий
            <input name="batch_count" type="number" min="0.001" step="0.001" defaultValue="1" />
          </label>
          <label className="admin-field">
            Фактический выход, {recipe?.output_unit ?? "ед."}
            <input name="output_quantity" type="number" min="0.001" step="0.001" value={outputQuantity} onChange={(event) => setOutputQuantity(Number(event.target.value) || 0)} />
          </label>
          <label className="admin-field sm:col-span-2">
            Комментарий
            <textarea name="notes" rows={2} placeholder="Номер партии, отклонение выхода, смена" />
          </label>
          <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-karimoff-muted">Доступно по сырью: {recipe?.available_batches ?? 0} полных партий.</p>
            <button type="submit" className="admin-primary-button">Провести выпуск</button>
          </div>
        </div>
      ) : (
        <p className="admin-empty mt-5">Сначала создайте и включите производственную карту.</p>
      )}
    </form>
  );
}
