import {
  ANALYTICS_CHANNELS,
  ANALYTICS_COMPARISONS,
  ANALYTICS_METRICS,
  ANALYTICS_PERIODS,
  type AnalyticsFilters
} from "./types";

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: RawParams, key: string) {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function limited(value: string, max = 200) {
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function date(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function parseAnalyticsFilters(params: RawParams): AnalyticsFilters {
  const periodValue = read(params, "period");
  const comparisonValue = read(params, "compare");
  const channelValue = read(params, "channel");
  const metricValue = read(params, "metric");
  const rankingValue = read(params, "ranking");
  const heatmapValue = read(params, "heatmap");
  const sortValue = read(params, "sort");
  const directionValue = read(params, "direction");
  const pageValue = Number(read(params, "page"));
  const pageSizeValue = Number(read(params, "pageSize"));

  return {
    period: ANALYTICS_PERIODS.includes(periodValue as never) ? (periodValue as AnalyticsFilters["period"]) : "30d",
    dateFrom: date(read(params, "from")),
    dateTo: date(read(params, "to")),
    comparison: ANALYTICS_COMPARISONS.includes(comparisonValue as never)
      ? (comparisonValue as AnalyticsFilters["comparison"])
      : "previous_period",
    channel:
      channelValue === "all" || ANALYTICS_CHANNELS.includes(channelValue as never)
        ? (channelValue as AnalyticsFilters["channel"])
        : "all",
    location: limited(read(params, "location")),
    terminal: limited(read(params, "terminal")),
    employee: limited(read(params, "employee")),
    payment: limited(read(params, "payment")),
    category: limited(read(params, "category")),
    product: limited(read(params, "product")),
    metric: ANALYTICS_METRICS.includes(metricValue as never)
      ? (metricValue as AnalyticsFilters["metric"])
      : "revenue",
    breakdown: read(params, "breakdown") === "channels",
    heatmapMetric: heatmapValue === "sales" ? "sales" : "revenue",
    productRanking:
      rankingValue === "quantity" || rankingValue === "growth" || rankingValue === "decline"
        ? rankingValue
        : "revenue",
    search: limited(read(params, "search"), 120) ?? "",
    sort:
      sortValue === "number" ||
      sortValue === "channel" ||
      sortValue === "location" ||
      sortValue === "total" ||
      sortValue === "net" ||
      sortValue === "status"
        ? sortValue
        : "date",
    direction: directionValue === "asc" ? "asc" : "desc",
    page: Number.isFinite(pageValue) ? Math.max(1, Math.trunc(pageValue)) : 1,
    pageSize: Number.isFinite(pageSizeValue)
      ? Math.min(100, Math.max(10, Math.trunc(pageSizeValue)))
      : 25
  };
}

export function analyticsFiltersToParams(filters: AnalyticsFilters) {
  const params = new URLSearchParams();
  params.set("period", filters.period);
  params.set("compare", filters.comparison);
  params.set("channel", filters.channel);
  params.set("metric", filters.metric);
  if (filters.dateFrom) params.set("from", filters.dateFrom);
  if (filters.dateTo) params.set("to", filters.dateTo);
  if (filters.location) params.set("location", filters.location);
  if (filters.terminal) params.set("terminal", filters.terminal);
  if (filters.employee) params.set("employee", filters.employee);
  if (filters.payment) params.set("payment", filters.payment);
  if (filters.category) params.set("category", filters.category);
  if (filters.product) params.set("product", filters.product);
  if (filters.breakdown) params.set("breakdown", "channels");
  if (filters.search) params.set("search", filters.search);
  if (filters.heatmapMetric !== "revenue") params.set("heatmap", filters.heatmapMetric);
  if (filters.productRanking !== "revenue") params.set("ranking", filters.productRanking);
  if (filters.sort !== "date") params.set("sort", filters.sort);
  if (filters.direction !== "desc") params.set("direction", filters.direction);
  if (filters.page !== 1) params.set("page", String(filters.page));
  if (filters.pageSize !== 25) params.set("pageSize", String(filters.pageSize));
  return params;
}

export function patchAnalyticsParams(filters: AnalyticsFilters, patch: Record<string, string | null>) {
  const params = analyticsFiltersToParams(filters);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  return params.toString();
}
