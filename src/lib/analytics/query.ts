import type { AnalyticsFilters, AnalyticsRange, AnalyticsScope } from "./types";

export type ParameterizedQuery = {
  text: string;
  values: unknown[];
};

class Parameters {
  values: unknown[] = [];

  constructor(private readonly offset = 0) {}

  add(value: unknown, cast = "") {
    this.values.push(value);
    return `$${this.values.length + this.offset}${cast}`;
  }
}
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

type SaleWhereOptions = {
  alias?: string;
  includeSearch?: boolean;
  includedOnly?: boolean;
  includeItemFilters?: boolean;
};

export function buildSalesWhere(
  filters: AnalyticsFilters,
  range: AnalyticsRange,
  scope: AnalyticsScope,
  options: SaleWhereOptions = {}
): ParameterizedQuery {
  const alias = options.alias ?? "s";
  const parameters = new Parameters();
  const clauses = [
    `${alias}.analytics_at >= ${parameters.add(range.from.toISOString(), "::timestamptz")}`,
    `${alias}.analytics_at < ${parameters.add(range.to.toISOString(), "::timestamptz")}`
  ];

  if (options.includedOnly) clauses.push(`${alias}.analytics_included = true`);
  if (filters.channel !== "all") {
    clauses.push(`${alias}.source = ${parameters.add(filters.channel)}`);
  }
  if (filters.location) clauses.push(`${alias}.location_id = ${parameters.add(filters.location)}`);
  if (filters.terminal) clauses.push(`${alias}.terminal_id = ${parameters.add(filters.terminal)}`);
  if (filters.employee) clauses.push(`${alias}.employee_id = ${parameters.add(filters.employee)}`);
  if (filters.payment) clauses.push(`${alias}.payment_method = ${parameters.add(filters.payment)}`);
  if (filters.weekdays.length) {
    clauses.push(`extract(isodow from ${alias}.analytics_at at time zone 'Europe/Moscow')::integer = any(${parameters.add(filters.weekdays, "::integer[]")})`);
  }
  if (filters.hourFrom !== null && filters.hourTo !== null) {
    clauses.push(`extract(hour from ${alias}.analytics_at at time zone 'Europe/Moscow')::integer >= ${parameters.add(filters.hourFrom, "::integer")}`);
    clauses.push(`extract(hour from ${alias}.analytics_at at time zone 'Europe/Moscow')::integer < ${parameters.add(filters.hourTo, "::integer")}`);
  }

  if (scope.locationIds !== null) {
    if (!scope.locationIds.length) clauses.push("false");
    else clauses.push(`${alias}.location_id = any(${parameters.add(scope.locationIds, "::text[]")})`);
  }

  const categories = filters.categories.length ? filters.categories : filters.category ? [filters.category] : [];
  if (options.includeItemFilters !== false && categories.length) {
    clauses.push(`exists (
      select 1 from public.analytics_sale_items filter_item
      where filter_item.sale_id = ${alias}.sale_id
        and filter_item.category = any(${parameters.add(categories, "::text[]")})
    )`);
  }
  if (options.includeItemFilters !== false && filters.product) {
    clauses.push(`exists (
      select 1 from public.analytics_sale_items filter_item
      where filter_item.sale_id = ${alias}.sale_id
        and coalesce(
          filter_item.product_id::text,
          filter_item.source || ':' || coalesce(filter_item.source_product_id, filter_item.external_source_id)
        ) = ${parameters.add(filters.product)}
    )`);
  }

  if (options.includeSearch && filters.search) {
    const query = parameters.add(`%${escapeLike(filters.search)}%`);
    clauses.push(`(
      ${alias}.order_number ilike ${query} escape '\\'
      or coalesce(${alias}.customer_name, '') ilike ${query} escape '\\'
      or coalesce(${alias}.employee_name, '') ilike ${query} escape '\\'
      or ${alias}.location_name ilike ${query} escape '\\'
      or exists (
        select 1 from public.analytics_sale_items search_item
        where search_item.sale_id = ${alias}.sale_id
          and search_item.product_name ilike ${query} escape '\\'
      )
    )`);
  }

  return { text: clauses.join(" and "), values: parameters.values };
}

export function buildItemWhere(
  filters: AnalyticsFilters,
  options: { alias?: string; offset?: number; includeCategory?: boolean; includeProduct?: boolean } = {}
): ParameterizedQuery {
  const alias = options.alias ?? "i";
  const parameters = new Parameters(options.offset ?? 0);
  const clauses: string[] = [];
  const categories = filters.categories.length ? filters.categories : filters.category ? [filters.category] : [];
  if (options.includeCategory !== false && categories.length) {
    clauses.push(`${alias}.category = any(${parameters.add(categories, "::text[]")})`);
  }
  if (options.includeProduct !== false && filters.product) {
    clauses.push(`coalesce(
      ${alias}.product_id::text,
      ${alias}.source || ':' || coalesce(${alias}.source_product_id, ${alias}.external_source_id)
    ) = ${parameters.add(filters.product)}`);
  }
  return { text: clauses.length ? clauses.join(" and ") : "true", values: parameters.values };
}

export function buildScopeWhere(scope: AnalyticsScope, alias = "s"): ParameterizedQuery {
  if (scope.locationIds === null) return { text: "true", values: [] };
  if (!scope.locationIds.length) return { text: "false", values: [] };
  return { text: `${alias}.location_id = any($1::text[])`, values: [scope.locationIds] };
}

export function offsetPlaceholders(text: string, offset: number) {
  if (!offset) return text;
  return text.replace(/\$(\d+)/g, (_, value: string) => `$${Number(value) + offset}`);
}
