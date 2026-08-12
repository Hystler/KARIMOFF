import { z } from "zod";

const productionUnitSchema = z.enum(["g", "kg", "ml", "l", "pcs"]);
const directExpenseCategorySchema = z.enum([
  "labor",
  "electricity",
  "packaging",
  "supplies",
  "logistics",
  "other"
]);

export const productionComponentSchema = z.object({
  ingredient_id: z.string().uuid("Выберите ингредиент"),
  quantity: z.coerce.number().positive("Количество сырья должно быть больше нуля"),
  unit: productionUnitSchema,
  is_primary: z.coerce.boolean().default(false),
  sort_order: z.coerce.number().int().min(0).default(100)
});

export const productionDirectExpenseSchema = z.object({
  category: directExpenseCategorySchema,
  name: z.string().trim().min(2, "Укажите статью расхода").max(120),
  amount_per_batch: z.coerce.number().min(0, "Расход не может быть отрицательным"),
  sort_order: z.coerce.number().int().min(0).default(100)
});

export const productionRecipeSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2, "Укажите название карты").max(140),
  output_ingredient_id: z.string().uuid("Выберите выходной полуфабрикат"),
  category: z.string().trim().max(80).optional(),
  output_quantity: z.coerce.number().positive("Выход партии должен быть больше нуля"),
  output_unit: productionUnitSchema,
  batch_duration_minutes: z.coerce.number().int().positive("Длительность должна быть больше нуля"),
  planned_batches_per_month: z.coerce.number().min(0, "План не может быть отрицательным"),
  sale_price_per_output_unit: z.coerce.number().min(0, "Цена не может быть отрицательной"),
  notes: z.string().trim().max(1000).optional(),
  is_active: z.coerce.boolean().default(false),
  sort_order: z.coerce.number().int().min(0).default(100),
  components: z.array(productionComponentSchema).min(1, "Добавьте сырьё"),
  expenses: z.array(productionDirectExpenseSchema).max(30)
}).superRefine((value, context) => {
  if (value.components.filter((component) => component.is_primary).length > 1) {
    context.addIssue({ code: "custom", message: "Основным сырьём можно отметить только одну строку" });
  }
  if (new Set(value.components.map((component) => component.ingredient_id)).size !== value.components.length) {
    context.addIssue({ code: "custom", message: "Один ингредиент нельзя добавить в карту дважды" });
  }
  if (value.components.some((component) => component.ingredient_id === value.output_ingredient_id)) {
    context.addIssue({ code: "custom", message: "Выходной полуфабрикат нельзя использовать как сырьё этой же карты" });
  }
});

export const productionOverheadSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Укажите статью расхода").max(120),
  category: z.enum([
    "payroll",
    "rent",
    "utilities",
    "sanitation",
    "maintenance",
    "accounting",
    "stationery",
    "logistics",
    "other"
  ]),
  quantity: z.coerce.number().min(0, "Количество не может быть отрицательным"),
  amount_per_unit: z.coerce.number().min(0, "Сумма не может быть отрицательной"),
  comment: z.string().trim().max(500).optional(),
  is_active: z.coerce.boolean().default(false),
  sort_order: z.coerce.number().int().min(0).default(100)
});

export const productionRunSchema = z.object({
  recipe_id: z.string().uuid("Выберите производственную карту"),
  batch_count: z.coerce.number().positive("Количество партий должно быть больше нуля").max(1000),
  output_quantity: z.coerce.number().positive("Фактический выход должен быть больше нуля"),
  notes: z.string().trim().max(1000).optional()
});
