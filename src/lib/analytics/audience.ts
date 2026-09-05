import "server-only";

import { getPostgresSql } from "@/lib/postgres/server";
import { buildSalesWhere } from "./query";
import type {
  AnalyticsFilters,
  AnalyticsRange,
  AnalyticsScope,
  AudienceAgeRow,
  AudienceDashboard,
  AudienceFrequencyRow,
  AudienceIdentityRow,
  AudiencePreferenceRow,
  AudienceSegment,
  AudienceSegmentKey
} from "./types";

type CustomerMetricRow = {
  customer_id: string;
  birthday: string | null;
  orders: string | number;
  revenue: string | number;
  first_purchase_at: string;
  last_purchase_at: string;
};

type CoverageRow = {
  total_sales: string | number;
  identified_sales: string | number;
  active_customers: string | number;
};

type PreferenceRow = {
  product_key: string;
  product_name: string;
  customers: string | number;
  revenue: string | number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const segmentOrder: AudienceSegmentKey[] = ["loyal", "returning", "new", "at_risk", "sleeping"];
const segmentCopy: Record<AudienceSegmentKey, { label: string; description: string }> = {
  loyal: { label: "Постоянные", description: "5+ заказов, покупали не позднее 45 дней назад" },
  returning: { label: "Возвращаются", description: "2+ заказа, покупали не позднее 60 дней назад" },
  new: { label: "Новые", description: "Первый заказ сделали не позднее 30 дней назад" },
  at_risk: { label: "Риск ухода", description: "Покупали 61–120 дней назад" },
  sleeping: { label: "Спящие", description: "Не покупали больше 120 дней" }
};

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle] ?? null
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function segmentFor(orders: number, recencyDays: number): AudienceSegmentKey {
  if (orders === 1 && recencyDays <= 30) return "new";
  if (orders >= 5 && recencyDays <= 45) return "loyal";
  if (orders >= 2 && recencyDays <= 60) return "returning";
  if (orders >= 2 && recencyDays <= 120) return "at_risk";
  return "sleeping";
}

function ageAt(birthday: string | null, at: Date) {
  if (!birthday) return null;
  const birth = new Date(`${birthday}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || birth > at) return null;
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = at.getUTCMonth() < birth.getUTCMonth()
    || (at.getUTCMonth() === birth.getUTCMonth() && at.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

function buildAgeGroups(rows: CustomerMetricRow[], at: Date): { coverage: number; groups: AudienceAgeRow[] } {
  const ages = rows.map((row) => ageAt(row.birthday, at)).filter((value): value is number => value !== null);
  const coverage = percent(ages.length, rows.length);
  if (ages.length < 10) return { coverage, groups: [] };
  const definitions = [
    ["under18", "До 18", 0, 17],
    ["18-24", "18–24", 18, 24],
    ["25-34", "25–34", 25, 34],
    ["35-44", "35–44", 35, 44],
    ["45-54", "45–54", 45, 54],
    ["55plus", "55+", 55, 120]
  ] as const;
  const groups = definitions.map(([key, label, minimum, maximum]) => {
    const customers = ages.filter((age) => age >= minimum && age <= maximum).length;
    return { key, label, customers, share: percent(customers, ages.length) };
  }).filter((row) => row.customers > 0);
  // Small buckets could identify individual guests in a young database.
  return groups.some((row) => row.customers < 3) ? { coverage, groups: [] } : { coverage, groups };
}

async function query<T>(text: string, values: unknown[] = []) {
  return getPostgresSql().unsafe<T[]>(text, values as never[]);
}

export async function getAudienceDashboard(params: {
  filters: AnalyticsFilters;
  range: AnalyticsRange;
  scope: AnalyticsScope;
}): Promise<AudienceDashboard> {
  const { filters, range, scope } = params;
  const periodWhere = buildSalesWhere(filters, range, scope, {
    alias: "s",
    includedOnly: true
  });
  const lifetimeRange: AnalyticsRange = {
    ...range,
    from: new Date("2000-01-01T00:00:00.000Z"),
    fromDateKey: "2000-01-01"
  };
  const lifetimeWhere = buildSalesWhere(filters, lifetimeRange, scope, {
    alias: "s",
    includedOnly: true
  });

  const [customerRows, periodCustomerRows, coverageRows, preferenceRows] = await Promise.all([
    query<CustomerMetricRow>(`
      select
        s.customer_id,
        customer.birthday::text,
        count(*) filter (where s.sale_count_eligible)::integer as orders,
        coalesce(sum(s.net_revenue), 0)::numeric as revenue,
        min(s.analytics_at)::text as first_purchase_at,
        max(s.analytics_at)::text as last_purchase_at
      from public.canonical_analytics_sales s
      join public.customers customer on customer.id = s.customer_id
      where ${lifetimeWhere.text}
        and s.customer_id is not null
        and s.sale_count_eligible
      group by s.customer_id, customer.birthday
    `, lifetimeWhere.values),
    query<CustomerMetricRow>(`
      select
        s.customer_id,
        customer.birthday::text,
        count(*) filter (where s.sale_count_eligible)::integer as orders,
        coalesce(sum(s.net_revenue), 0)::numeric as revenue,
        min(s.analytics_at)::text as first_purchase_at,
        max(s.analytics_at)::text as last_purchase_at
      from public.canonical_analytics_sales s
      join public.customers customer on customer.id = s.customer_id
      where ${periodWhere.text}
        and s.customer_id is not null
        and s.sale_count_eligible
      group by s.customer_id, customer.birthday
    `, periodWhere.values),
    query<CoverageRow>(`
      select
        count(*) filter (where s.sale_count_eligible)::integer as total_sales,
        count(*) filter (where s.sale_count_eligible and s.customer_id is not null)::integer as identified_sales,
        count(distinct s.customer_id) filter (where s.sale_count_eligible and s.customer_id is not null)::integer as active_customers
      from public.canonical_analytics_sales s
      where ${periodWhere.text}
    `, periodWhere.values),
    query<PreferenceRow>(`
      select
        coalesce(i.product_id::text, i.source || ':' || coalesce(i.source_product_id, i.external_source_id)) as product_key,
        i.product_name,
        count(distinct s.customer_id)::integer as customers,
        coalesce(sum(i.net_revenue), 0)::numeric as revenue
      from public.canonical_analytics_sales s
      join public.analytics_sale_items i on i.sale_id = s.sale_id
      where ${periodWhere.text}
        and s.customer_id is not null
        and s.sale_count_eligible
        and i.operation_type = 'sale'
      group by 1, 2
      order by customers desc, revenue desc
      limit 8
    `, periodWhere.values)
  ]);

  const customerIds = customerRows.map((row) => row.customer_id);
  const [identityRows, supportRows] = customerIds.length ? await Promise.all([
    query<{ provider: AudienceIdentityRow["provider"]; customers: string | number }>(`
      select identity.provider, count(distinct identity.user_id)::integer as customers
      from public.user_identities identity
      where identity.user_id = any($1::uuid[])
        and identity.provider in ('telegram', 'max', 'phone')
        and identity.linked_at < $2::timestamptz
      group by identity.provider
    `, [customerIds, range.to.toISOString()]),
    query<{ cards: string | number; marketing: string | number }>(`
      with latest_marketing as (
        select distinct on (consent.subject_id)
          consent.subject_id,
          consent.granted
        from public.legal_consents consent
        where consent.subject_type = 'customer'
          and consent.consent_type = 'marketing'
          and consent.subject_id = any($1::uuid[])
          and consent.created_at < $2::timestamptz
        order by consent.subject_id, consent.created_at desc
      )
      select
        count(distinct card.customer_id) filter (
          where card.status = 'active' and card.issued_at < $2::timestamptz
        )::integer as cards,
        count(*) filter (where latest_marketing.granted)::integer as marketing
      from unnest($1::uuid[]) as audience(customer_id)
      left join public.loyalty_cards card on card.customer_id = audience.customer_id
      left join latest_marketing on latest_marketing.subject_id = audience.customer_id
    `, [customerIds, range.to.toISOString()])
  ]) : [[], []];

  const at = range.to;
  const segmentMap = new Map<AudienceSegmentKey, { customers: number; revenue: number; orders: number }>(
    segmentOrder.map((key) => [key, { customers: 0, revenue: 0, orders: 0 }])
  );
  const recencies: number[] = [];
  let lifetimeRevenue = 0;
  let lifetimeOrders = 0;
  let repeatCustomers = 0;

  for (const row of customerRows) {
    const orders = number(row.orders);
    const revenue = number(row.revenue);
    const recency = Math.max(0, Math.floor((at.getTime() - new Date(row.last_purchase_at).getTime()) / DAY_MS));
    const key = segmentFor(orders, recency);
    const segment = segmentMap.get(key)!;
    segment.customers += 1;
    segment.revenue += revenue;
    segment.orders += orders;
    recencies.push(recency);
    lifetimeRevenue += revenue;
    lifetimeOrders += orders;
    if (orders >= 2) repeatCustomers += 1;
  }

  const customers = customerRows.length;
  const segments: AudienceSegment[] = segmentOrder.map((key) => {
    const value = segmentMap.get(key)!;
    return {
      key,
      ...segmentCopy[key],
      customers: value.customers,
      share: percent(value.customers, customers),
      revenue: value.revenue,
      averageCheck: value.orders > 0 ? value.revenue / value.orders : 0
    };
  });
  const frequencyDefinitions = [
    ["one", "1 заказ", 1, 1],
    ["two-three", "2–3 заказа", 2, 3],
    ["four-seven", "4–7 заказов", 4, 7],
    ["eight-plus", "8+ заказов", 8, Number.POSITIVE_INFINITY]
  ] as const;
  const frequencies: AudienceFrequencyRow[] = frequencyDefinitions.map(([key, label, minimum, maximum]) => {
    const count = customerRows.filter((row) => number(row.orders) >= minimum && number(row.orders) <= maximum).length;
    return { key, label, customers: count, share: percent(count, customers) };
  });
  const providerLabels = { telegram: "Telegram", max: "MAX", phone: "Телефон" } as const;
  const identities: AudienceIdentityRow[] = identityRows.map((row) => ({
    provider: row.provider,
    label: providerLabels[row.provider],
    customers: number(row.customers),
    share: percent(number(row.customers), customers)
  })).sort((left, right) => right.customers - left.customers);
  const totalPreferenceCustomers = Math.max(1, periodCustomerRows.length);
  const preferences: AudiencePreferenceRow[] = preferenceRows.map((row) => ({
    key: row.product_key,
    name: row.product_name,
    customers: number(row.customers),
    revenue: number(row.revenue),
    share: percent(number(row.customers), totalPreferenceCustomers)
  }));
  const age = buildAgeGroups(customerRows, at);
  const coverage = coverageRows[0] ?? { total_sales: 0, identified_sales: 0, active_customers: 0 };
  const support = supportRows[0] ?? { cards: 0, marketing: 0 };
  const dominantSegment = segments.filter((row) => row.customers > 0).sort((left, right) => right.customers - left.customers)[0];
  const topPreference = preferences[0];
  const periodRevenue = periodCustomerRows.reduce((sum, row) => sum + number(row.revenue), 0);

  return {
    rangeLabel: range.label,
    customers,
    activeCustomers: number(coverage.active_customers),
    identifiedSales: number(coverage.identified_sales),
    totalSales: number(coverage.total_sales),
    identifiedCoveragePercent: percent(number(coverage.identified_sales), number(coverage.total_sales)),
    repeatRatePercent: percent(repeatCustomers, customers),
    averageLifetimeRevenue: customers ? lifetimeRevenue / customers : 0,
    averageLifetimeOrders: customers ? lifetimeOrders / customers : 0,
    medianRecencyDays: median(recencies),
    marketingReachPercent: percent(number(support.marketing), customers),
    loyaltyCardCoveragePercent: percent(number(support.cards), customers),
    ageCoveragePercent: age.coverage,
    coreSummary: customers
      ? `${dominantSegment?.label ?? "Гости"}${topPreference ? ` · чаще выбирают «${topPreference.name}»` : ""}. За период идентифицированная аудитория принесла ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(periodRevenue)} ₽.`
      : "Профиль аудитории появится после первых идентифицированных заказов.",
    segments,
    frequencies,
    identities,
    preferences,
    ageGroups: age.groups
  };
}
