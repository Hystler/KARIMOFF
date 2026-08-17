# KARIMOFF Premium Analytics: audit

## Current data sources

- `canonical_analytics_sales` is the trusted sale-level source. It combines Evotor POS receipts and eligible KARIMOFF web orders, excludes test orders, and suppresses only confirmed web/POS reconciliations.
- `analytics_sale_items` contains POS and web line items. Evotor products remain visible when they are not mapped; only confirmed mappings inherit a KARIMOFF product/category.
- `analytics_sale_payments` normalizes the available payment data. POS payment types are mapped to cash, bank card, SBP or unknown. Web payments are included only from paid payment records.
- Business days are currently calculated in `Europe/Moscow`. The permission layer restricts managers by `staff_location_access` and fails closed when no location is assigned.

## What is already reliable

- Net revenue, sale count, refunds and completed/paid web-order eligibility are calculated server-side from database views.
- POS returns are negative revenue and are not counted as positive sales.
- Confirmed reconciliation prevents the same web order and fiscal receipt from being counted twice.
- Sales journal search, filtering, sorting, pagination and CSV streaming run on the server.
- Test orders are excluded from canonical analytics and do not mutate real inventory.
- Existing timeline, channel mix, payment mix, weekday/hour heatmap and product/location/employee breakdowns are useful foundations.

## Accuracy gap found during the audit

The previous category/product filter selected receipts containing the requested item, but some sale-level KPIs still summed the complete receipt. For example, a receipt containing a burger and a drink was fully included in the burger revenue. Premium analytics must instead use matching line-item revenue and quantity while defining the receipt KPI as “receipts containing the selection”. This iteration corrects that semantic split.

## Available POS and web fields

POS provides receipt time, store, terminal, employee when supplied by Evotor, receipt type, total, discount, payment types and line items. POS customers are generally unknown. Product category is unavailable until an Evotor product has a confirmed KARIMOFF mapping.

Web provides order/customer identifiers, status, payment/fiscal status, fulfillment details, products, categories and line totals. Only completed orders with an eligible payment state enter revenue. Unpaid, cancelled and test orders remain excluded.

## Mapping limitations

- Unmapped Evotor items have a stable external product identity and name, but no trustworthy KARIMOFF category.
- There is no reliable subcategory field in the current normalized views.
- Payment cannot be attributed exactly to one category inside a mixed basket. Category-level payment analysis therefore remains receipt-context analysis and is labelled as such.
- Employee identity is meaningful for POS only when Evotor supplied it; unknown employees are not invented.

## Missing analysis before this iteration

- Multiple categories, weekday and intraday time filters in shareable URLs.
- Category comparison curves, calendar heatmap, product demand profile and category overview cards.
- Treemap, Pareto/ABC, basket pairs, basket-size distribution and average-ticket decomposition.
- Deterministic change/peak observations, transparent anomaly guardrails and drill-through links.
- Explicit freshness/staleness status and expanded chart mode.

## Metrics intentionally unavailable

Food cost, COGS, gross profit, margin, waste and stock forecasts are not shown until recipe costs and inventory coverage are complete. Zero is not a valid substitute for missing cost data. The new report contracts keep room for these fields without exposing fabricated values.

## Chart stack decision

The existing accessible SVG/CSS stack is retained. The requested reports can be rendered with server-prepared aggregates, small SVG paths and semantic HTML. Adding Apache ECharts now would duplicate the current chart runtime and noticeably increase the analytics client bundle. A client-only ECharts boundary remains an extension point if future brush/zoom or very large multidimensional charts justify it.
