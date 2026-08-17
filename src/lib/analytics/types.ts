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
  "last_quarter",
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
export type HeatmapMetric = "revenue" | "sales" | "items";
export type DemandMetric = "revenue" | "items";
export type CalendarMetric = "revenue" | "sales" | "average_check";

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
  categories: string[];
  category: string | null;
  product: string | null;
  weekdays: number[];
  hourFrom: number | null;
  hourTo: number | null;
  metric: AnalyticsMetric;
  breakdown: boolean;
  heatmapMetric: HeatmapMetric;
  demandMetric: DemandMetric;
  calendarMetric: CalendarMetric;
  treemapMetric: DemandMetric;
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
  items: number;
};

export type AnalyticsCategoryCard = {
  id: string;
  name: string;
  revenue: number;
  quantity: number;
  receipts: number;
  averageItemPrice: number;
  share: number;
  delta: MetricDelta;
  sparkline: number[];
};

export type AnalyticsHourlyCategoryPoint = {
  hour: number;
  categories: Record<string, { revenue: number; quantity: number; receipts: number }>;
};

export type AnalyticsCalendarDay = {
  date: string;
  revenue: number;
  receipts: number;
  averageCheck: number;
};

export type AnalyticsTreemapItem = {
  key: string;
  name: string;
  category: string;
  revenue: number;
  quantity: number;
  share: number;
  mappingStatus: "mapped" | "unmapped";
};

export type AnalyticsParetoItem = {
  key: string;
  name: string;
  revenue: number;
  quantity: number;
  cumulativeShare: number;
  abc: "A" | "B" | "C";
};

export type AnalyticsParetoSummary = {
  totalProducts: number;
  productsTo50: number;
  productsTo80: number;
  productsTo90: number;
  rows: AnalyticsParetoItem[];
};

export type AnalyticsBasketPair = {
  leftKey: string;
  leftName: string;
  rightKey: string;
  rightName: string;
  baskets: number;
  support: number;
  confidence: number;
};

export type AnalyticsBasketSizeRow = {
  bucket: "1" | "2" | "3" | "4+";
  receipts: number;
  revenue: number;
  averageRevenue: number;
};

export type AnalyticsDaypartRow = {
  key: string;
  label: string;
  hours: string;
  revenue: number;
  receipts: number;
  quantity: number;
  averageCheck: number;
};

export type AnalyticsInsight = {
  id: string;
  tone: "positive" | "negative" | "neutral";
  title: string;
  detail: string;
  href: string;
};

export type AnalyticsProductProfile = {
  key: string;
  name: string;
  category: string | null;
  revenue: number;
  quantity: number;
  daysSold: number;
  averageUnitsPerDay: number;
  peakHour: number | null;
  strongestWeekday: number | null;
  weakestWeekday: number | null;
  categoryShare: number | null;
  delta: MetricDelta;
};

export type AnalyticsIntelligence = {
  categoryCards: AnalyticsCategoryCard[];
  hourlyDemand: AnalyticsHourlyCategoryPoint[];
  calendar: AnalyticsCalendarDay[];
  treemap: AnalyticsTreemapItem[];
  pareto: AnalyticsParetoSummary;
  basketPairs: AnalyticsBasketPair[];
  basketSizes: AnalyticsBasketSizeRow[];
  dayparts: AnalyticsDaypartRow[];
  peakHours: Array<{ hour: number; revenue: number; quantity: number; receipts: number }>;
  averageTicketFactors: {
    itemsPerReceipt: KpiValue;
    averageItemValue: KpiValue;
  };
  revenueBridge: {
    current: number;
    previous: number;
    receiptEffect: number;
    ticketEffect: number;
    refundChange: number;
  };
  insights: AnalyticsInsight[];
  productProfile: AnalyticsProductProfile | null;
  lastEvotorSyncAt: string | null;
  stale: boolean;
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
  itemFiltered: boolean;
  intelligence: AnalyticsIntelligence;
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
