"use client";

import { Factory } from "lucide-react";
import { useState } from "react";
import type { ProductionRecipeView } from "@/lib/production";
import { OperationsSubmitButton } from "./OperationsSubmitButton";
import styles from "./OperationsWorkspace.module.css";

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
    <form action={action} className={styles.section} aria-labelledby="production-run-heading">
      <div className={styles.sectionHeading}>
        <h2 id="production-run-heading">Зафиксировать выпуск</h2>
        <span className={styles.muted}>Доступно по сырью: {recipe?.available_batches ?? 0} полных партий</span>
      </div>

      {activeRecipes.length ? (
        <>
        <div className={`${styles.formGrid} ${styles.runGrid}`}>
          <label className={styles.field}>
            Производственная карта
            <select name="recipe_id" value={recipeId} onChange={(event) => selectRecipe(event.target.value)}>
              {activeRecipes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            Количество партий
            <input name="batch_count" type="number" min="0.001" step="0.001" defaultValue="1" />
          </label>
          <label className={styles.field}>
            Фактический выход, {recipe?.output_unit ?? "ед."}
            <input name="output_quantity" type="number" min="0.001" step="0.001" value={outputQuantity} onChange={(event) => setOutputQuantity(Number(event.target.value) || 0)} />
          </label>
          <label className={styles.field}>
            Комментарий
            <textarea name="notes" rows={1} placeholder="Номер партии, смена" />
          </label>
        </div>
        <div className={styles.formFooter}>
          <p className={styles.muted}>Сырьё спишется, остаток и себестоимость полуфабриката обновятся.</p>
          <OperationsSubmitButton><Factory size={15} />Провести выпуск</OperationsSubmitButton>
        </div>
        </>
      ) : (
        <p className={styles.empty}>Сначала создайте и включите производственную карту.</p>
      )}
    </form>
  );
}
