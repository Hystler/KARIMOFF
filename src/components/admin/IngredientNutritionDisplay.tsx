import { AlertTriangle } from "lucide-react";
import { formatNutritionValue, type getIngredientNutritionDisplay } from "@/lib/ingredient-nutrition-display";

type NutritionDisplay = ReturnType<typeof getIngredientNutritionDisplay>;

export function IngredientNutritionValues({ nutrition, issue }: {
  nutrition: NutritionDisplay["per100g"];
  issue?: string | null;
}) {
  if (!nutrition?.complete) {
    return <span className="inline-flex max-w-full items-start gap-1 text-xs font-semibold leading-4 text-amber-800">
      <AlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />
      <span>{issue ?? "КБЖУ не заполнены"}</span>
    </span>;
  }

  const [calories, ...macros] = nutrition.items;
  const abbreviations = { protein: "Б", fat: "Ж", carbs: "У", calories: "Ккал" };

  return <div className="text-xs leading-5 tabular-nums">
    <p className="font-semibold">{formatNutritionValue(calories.value)} ккал</p>
    <div className="flex flex-wrap gap-x-2 text-karimoff-muted">
      {macros.map(item => <span key={item.key} className="whitespace-nowrap" aria-label={`${item.label}: ${formatNutritionValue(item.value)} г`}>
        {abbreviations[item.key]} {formatNutritionValue(item.value)}
      </span>)}
      <span className="sr-only">Белки, жиры и углеводы в граммах</span>
    </div>
  </div>;
}

export function IngredientNutritionSource({ display }: { display: NutritionDisplay }) {
  if (display.issue) {
    return <p className="mt-1 text-xs font-semibold text-amber-800">{display.issue}</p>;
  }
  return <>
    {display.source ? <p className={`mt-1 text-xs ${display.source.estimated ? "text-amber-800" : "text-karimoff-muted"}`} title={display.source.name}>
      {display.source.estimated ? "КБЖУ: оценка" : "КБЖУ: этикетка"}
    </p> : null}
    {display.unitWeightG !== null && display.unitWeightG !== 1 ? <p className={`mt-1 text-xs ${display.massEstimated ? "text-amber-800" : "text-karimoff-muted"}`}>
      1 шт.: {formatNutritionValue(display.unitWeightG)} г{display.massEstimated ? " (оценка)" : ""}
    </p> : null}
  </>;
}
