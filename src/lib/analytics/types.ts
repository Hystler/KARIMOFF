export const ANALYTICS_CHANNELS = ["pos_evotor", "web", "mobile", "aggregator"] as const;
export type AnalyticsChannel = (typeof ANALYTICS_CHANNELS)[number];
export type AnalyticsChannelFilter = "all" | AnalyticsChannel;

export const ANALYTICS_PERIODS = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "custom"
] as const;
export type AnalyticsPeriodKey = (typeof ANALYTICS_PERIODS)[number];

export const ANALYTICS_COMPARISONS = [
  "previous_period",
  "previous_week",
  "previous_month",
  "previous_year"
] as const;
export type AnalyticsComparison = (typeof ANALYTICS_COMPARISONS)[number];

export const ANALYTICS_METRICS = ["revenue", "sales", "average_check", "items", "refunds"] as const;
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];
export type AnalyticsGranularity = "hour" | "day" | "week" | "month";
export type ProductRankingMode = "revenue" | "quantity" | "growth" | "decline";
export type HeatmapMetric = "revenue" | "sales";

export type AnalyticsFilters = {
  period: AnalyticsPeriodKey;
  dateFrom: string | null;
  dateTo: string | null;
  comparison: AnalyticsComparison;
  channel: AnalyticsChannelFilter;
  location: string | null;
  terminal: string | null;
  employee: string | null;
  payment: string | null;
  category: string | null;
  product: string | null;
  metric: AnalyticsMetric;
  breakdown: boolean;
  heatmapMetric: HeatmapMetric;
  productRanking: ProductRankingMode;
  search: string;
  sort: "date" | "number" | "channel" | "location" | "total" | "net" | "status";
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
};

export type AnalyticsRange = {
  from: Date;
  to: Date;
  fromDateKey: string;
  toDateKeyExclusive: string;
  label: string;
  period: AnalyticsPeriodKey;
  timezone: string;
};

export type AnalyticsScope = {
  role: "owner" | "admin" | "manager";
  locationIds: string[] | null;
  cacheKey: string;
};

export type MetricDelta = {
  absolute: number;
  percent: number | null;
  direction: "up" | "down" | "flat" | "new" | "unavailable";
};

export type KpiValue = {
  current: number;
  previous: number;
  delta: MetricDelta;
  sparkline: number[];
};

export type AnalyticsKpis = {
  revenue: KpiValue;
  sales: KpiValue;
  averageCheck: KpiValue;
  items: KpiValue;
  refunds: KpiValue;
  refundCount: KpiValue;
  discounts: KpiValue;
  customers: KpiValue;
  customersAvailable: boolean;
  discountsAvailable: boolean;
};

export type TimeSeriesPoint = {
  key: string;
  label: string;
  value: number;
  previousValue: number | null;
  channels?: Partial<Record<AnalyticsChannel, number>>;
};

export type AnalyticsOption = { value: string; label: string };

export type AnalyticsFilterOptions = {
  hasPreviousYear: boolean;
  channels: AnalyticsOption[];
  locations: AnalyticsOption[];
  terminals: AnalyticsOption[];
  employees: AnalyticsOption[];
  payments: AnalyticsOption[];
  categories: AnalyticsOption[];
  products: AnalyticsOption[];
};

export type AnalyticsProductRow = {
  key: string;
  name: string;
  category: string | null;
  quantity: number;
  revenue: number;
  averagePrice: number;
  share: number;
  previousRevenue: number;
  delta: MetricDelta;
  channel: AnalyticsChannel | "multiple";
  mappingStatus: "mapped" | "unmapped";
};

export type AnalyticsBreakdownRow = {
  id: string;
  name: string;
  revenue: number;
  sales: number;
  averageCheck: number;
  refunds: number;
  itemsPerCheck: number;
  share: number;
  delta: MetricDelta;
};

export type AnalyticsPaymentRow = AnalyticsBreakdownRow & {
  method: string;
};

export type HeatmapCell = {
  weekday: number;
  hour: number;
  revenue: number;
  sales: number;
};

export type WeekdayRow = {
  weekday: number;
  revenue: number;
  sales: number;
  averageCheck: number;
};

export type RevenueMixRow = {
  channel: AnalyticsChannel;
  revenue: number;
  sales: number;
  share: number;
};

export type AnalyticsDashboard = {
  filters: AnalyticsFilters;
  range: AnalyticsRange;
  comparisonRange: AnalyticsRange;
  granularity: AnalyticsGranularity;
  kpis: AnalyticsKpis;
  timeline: TimeSeriesPoint[];
  revenueMix: RevenueMixRow[];
  heatmap: HeatmapCell[];
  weekdays: WeekdayRow[];
  products: AnalyticsProductRow[];
  categories: AnalyticsBreakdownRow[];
  employees: AnalyticsBreakdownRow[];
  locations: AnalyticsBreakdownRow[];
  terminals: AnalyticsBreakdownRow[];
  payments: AnalyticsPaymentRow[];
  options: AnalyticsFilterOptions;
  updatedAt: string | null;
  error: string | null;
};

export type AnalyticsSaleRow = {
  saleId: string;
  externalSourceId: string;
  channel: AnalyticsChannel;
  sourceSubtype: string;
  number: string;
  analyticsAt: string;
  status: string;
  operationType: string;
  location: string;
  terminal: string | null;
  employee: string | null;
  customer: string | null;
  itemsCount: number;
  grossAmount: number;
  discountAmount: number;
  refundAmount: number;
  netRevenue: number;
  paymentMethod: string;
  currency: string;
  included: boolean;
};

export type AnalyticsSaleItem = {
  id: string;
  productId: string | null;
  sourceProductId: string | null;
  name: string;
  category: string | null;
  mappingStatus: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
};

export type AnalyticsSalePayment = {
  id: string;
  method: string;
  sourceMethod: string;
  amount: number;
  paidAt: string | null;
};

export type AnalyticsSaleDetail = {
  sale: AnalyticsSaleRow;
  items: AnalyticsSaleItem[];
  payments: AnalyticsSalePayment[];
  technical: {
    sourceRecordId: string;
    externalSourceId: string;
    sourceUpdatedAt: string | null;
  };
};

export type AnalyticsSalesPage = {
  rows: AnalyticsSaleRow[];
  totalRows: number;
  totalRevenue: number;
  page: number;
  pageSize: number;
  pageCount: number;
  options: AnalyticsFilterOptions;
  detail: AnalyticsSaleDetail | null;
  error: string | null;
};
