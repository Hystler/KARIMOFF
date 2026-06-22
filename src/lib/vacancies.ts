import "server-only";

import { formatMissingTableError } from "@/lib/supabase/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Vacancy = {
  id: string;
  created_at: string;
  updated_at: string | null;
  title: string;
  slug: string;
  department: string | null;
  employment_type: string | null;
  salary_from: number | null;
  salary_to: number | null;
  salary_unit: string;
  location: string | null;
  schedule: string | null;
  description: string | null;
  requirements: string | null;
  responsibilities: string | null;
  benefits: string | null;
  is_active: boolean;
  sort_order: number;
};

const fallbackVacancies: Vacancy[] = [
  {
    id: "demo-cook",
    created_at: "",
    updated_at: null,
    title: "Повар",
    slug: "cook",
    department: "Кухня",
    employment_type: "Сменный график",
    salary_from: 450,
    salary_to: null,
    salary_unit: "hour",
    location: "Точка KARIMOFF",
    schedule: "Гибкий график",
    description: "Готовить фирменные позиции KARIMOFF по стандартам и поддерживать порядок на рабочем месте.",
    requirements: null,
    responsibilities: null,
    benefits: "Обучение, поддержка команды, стабильные выплаты.",
    is_active: true,
    sort_order: 10
  },
  {
    id: "demo-admin",
    created_at: "",
    updated_at: null,
    title: "Администратор",
    slug: "administrator",
    department: "Сервис",
    employment_type: "Полная занятость",
    salary_from: null,
    salary_to: null,
    salary_unit: "month",
    location: "Точка KARIMOFF",
    schedule: "По договорённости",
    description: "Помогать команде держать темп, качество сервиса и порядок в операционных процессах.",
    requirements: null,
    responsibilities: null,
    benefits: "Обучение стандартам, рост внутри команды, понятная зона ответственности.",
    is_active: true,
    sort_order: 20
  },
  {
    id: "demo-courier",
    created_at: "",
    updated_at: null,
    title: "Курьер",
    slug: "courier",
    department: "Доставка",
    employment_type: "Подработка / смены",
    salary_from: null,
    salary_to: null,
    salary_unit: "shift",
    location: "Город присутствия",
    schedule: "Гибкий график",
    description: "Аккуратно доставлять заказы гостям и помогать сохранять впечатление от бренда после кухни.",
    requirements: null,
    responsibilities: null,
    benefits: "Гибкие смены и понятные процессы.",
    is_active: true,
    sort_order: 30
  }
];

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function normalizeVacancy(row: Record<string, unknown>): Vacancy {
  return {
    id: String(row.id),
    created_at: String(row.created_at ?? ""),
    updated_at: nullableString(row.updated_at),
    title: String(row.title ?? ""),
    slug: String(row.slug ?? ""),
    department: nullableString(row.department),
    employment_type: nullableString(row.employment_type),
    salary_from: nullableNumber(row.salary_from),
    salary_to: nullableNumber(row.salary_to),
    salary_unit: String(row.salary_unit ?? "hour"),
    location: nullableString(row.location),
    schedule: nullableString(row.schedule),
    description: nullableString(row.description),
    requirements: nullableString(row.requirements),
    responsibilities: nullableString(row.responsibilities),
    benefits: nullableString(row.benefits),
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order ?? 100)
  };
}

export async function getActiveVacancies() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      vacancies: fallbackVacancies,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase
    .from("vacancies")
    .select(
      "id, created_at, updated_at, title, slug, department, employment_type, salary_from, salary_to, salary_unit, location, schedule, description, requirements, responsibilities, benefits, is_active, sort_order"
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Vacancies fallback is used:", error.message);
    }

    return {
      vacancies: fallbackVacancies,
      notConfigured: false,
      error: formatMissingTableError(error.message, "vacancies", "supabase/vacancies.sql")
    };
  }

  return {
    vacancies: (data ?? []).map((row) => normalizeVacancy(row)),
    notConfigured: false,
    error: null as string | null
  };
}

export async function getAdminVacancies() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      vacancies: [] as Vacancy[],
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase
    .from("vacancies")
    .select(
      "id, created_at, updated_at, title, slug, department, employment_type, salary_from, salary_to, salary_unit, location, schedule, description, requirements, responsibilities, benefits, is_active, sort_order"
    )
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  return {
    vacancies: (data ?? []).map((row) => normalizeVacancy(row)),
    notConfigured: false,
    error: formatMissingTableError(error?.message, "vacancies", "supabase/vacancies.sql")
  };
}

export async function getAdminVacancyById(id: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return {
      vacancy: null as Vacancy | null,
      notConfigured: true,
      error: null as string | null
    };
  }

  const { data, error } = await supabase
    .from("vacancies")
    .select(
      "id, created_at, updated_at, title, slug, department, employment_type, salary_from, salary_to, salary_unit, location, schedule, description, requirements, responsibilities, benefits, is_active, sort_order"
    )
    .eq("id", id)
    .maybeSingle();

  return {
    vacancy: data ? normalizeVacancy(data) : null,
    notConfigured: false,
    error: formatMissingTableError(error?.message, "vacancies", "supabase/vacancies.sql")
  };
}

export function formatVacancySalary(vacancy: Pick<Vacancy, "salary_from" | "salary_to" | "salary_unit">) {
  if (vacancy.salary_from === null && vacancy.salary_to === null) {
    return null;
  }

  const unitLabel =
    vacancy.salary_unit === "hour"
      ? "в час"
      : vacancy.salary_unit === "month"
        ? "в месяц"
        : vacancy.salary_unit === "shift"
          ? "за смену"
          : vacancy.salary_unit;
  const format = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);

  if (vacancy.salary_from !== null && vacancy.salary_to !== null) {
    return `${format(vacancy.salary_from)}–${format(vacancy.salary_to)} ₽ ${unitLabel}`;
  }

  if (vacancy.salary_from !== null) {
    return `от ${format(vacancy.salary_from)} ₽ ${unitLabel}`;
  }

  return `до ${format(vacancy.salary_to ?? 0)} ₽ ${unitLabel}`;
}
