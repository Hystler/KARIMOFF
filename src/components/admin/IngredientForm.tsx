import type { Ingredient } from "@/lib/ingredients";

type IngredientFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  ingredient?: Ingredient | null;
  submitLabel: string;
};

const units = [
  { value: "g", label: "граммы" },
  { value: "ml", label: "миллилитры" },
  { value: "pcs", label: "штуки" }
];

export function IngredientForm({ action, ingredient, submitLabel }: IngredientFormProps) {
  return (
    <form action={action} className="mt-8 grid gap-5 rounded-[1.25rem] border border-karimoff-line bg-white p-5 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-7">
      {ingredient ? <input type="hidden" name="id" value={ingredient.id} /> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Название
          <input name="name" required defaultValue={ingredient?.name ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]" placeholder="Котлета говяжья" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Категория
          <input name="category" defaultValue={ingredient?.category ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" placeholder="Мясо / овощи / соусы" />
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Единица
          <select name="unit" defaultValue={ingredient?.unit ?? "g"} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange">
            {units.map((unit) => (
              <option key={unit.value} value={unit.value}>
                {unit.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Упаковка
          <input name="package_size" type="number" min="0" step="0.001" defaultValue={ingredient?.package_size ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" placeholder="1000" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Цена упаковки
          <input name="package_price" type="number" min="0" step="0.01" defaultValue={ingredient?.package_price ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" placeholder="500" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          ₽ за единицу
          <input name="cost_per_unit" type="number" min="0" step="0.0001" defaultValue={ingredient?.cost_per_unit ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" placeholder="Авто из упаковки" />
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Порядок
          <input name="sort_order" type="number" min="0" step="1" defaultValue={ingredient?.sort_order ?? 100} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" />
        </label>
        <label className="flex items-center gap-3 self-end rounded-xl border border-karimoff-line px-4 py-3 text-sm font-semibold text-karimoff-black">
          <input name="is_active" type="checkbox" defaultChecked={ingredient?.is_active ?? true} className="h-5 w-5 accent-karimoff-orange" />
          Активен
        </label>
      </div>

      <button
        type="submit"
        className="w-fit rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-4 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0"
      >
        {submitLabel}
      </button>
    </form>
  );
}
