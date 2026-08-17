# KARIMOFF Premium Analytics

## Purpose

The analytics hub is a server-calculated management view over the canonical sales model. It combines eligible Evotor POS receipts and KARIMOFF web orders without treating every technical receipt or order event as a separate sale.

The implementation is read-only toward Evotor. It does not change POS products, stock, receipts, orders, inventory or fiscal data.

## Trusted sources

- `canonical_analytics_sales` is the sale-level source.
- `analytics_sale_items` is the line-item source.
- `analytics_sale_payments` is the normalized payment source.
- `analytics_sale_reconciliations` suppresses only reliably confirmed web/POS duplicates.
- Confirmed product mappings attach a KARIMOFF product and category to an Evotor line. Unmapped POS products remain visible with their stable source identity.

Test orders, cancelled web orders and web orders that do not satisfy the canonical revenue rule are excluded by the database views. The dashboard never mutates these views or their source tables.

## Metric definitions

All financial aggregation runs in PostgreSQL using `numeric`; JavaScript receives finalized report values.

- **Revenue**: canonical net revenue after discounts and refunds.
- **Receipts / sales**: distinct operations eligible for sale counting. A refund is not a positive sale.
- **Average receipt**: sale revenue divided by eligible receipt count. Empty periods return zero without a meaningless percentage change.
- **Items sold**: sum of positive sale-line quantities.
- **Refunds**: refund amount and count of operations containing a refund.
- **Discounts**: shown only when the source marks discount data as available.
- **Customers**: distinct known customer IDs. Anonymous POS buyers are not inferred.

When an item filter is active, revenue, discounts, refunds and quantity use only matching lines. The receipt count means "receipts containing the selection". A mixed burger-and-drink receipt therefore contributes only the burger line to burger revenue, while counting once as a receipt containing burgers.

Payment analytics is sale-level. A payment cannot be truthfully split between categories inside a mixed basket, so category-filtered payment mix is explicitly labelled as receipt context.

## Filters

The complete filter state is serialized into the URL and restored after refresh:

- Today, yesterday, 7 days, 30 days;
- this/previous week;
- this/previous month;
- this/previous quarter;
- custom date range;
- comparison period;
- channel;
- location;
- terminal;
- employee;
- payment method;
- one to five categories;
- product;
- weekdays;
- intraday hour range;
- chart metrics and channel breakdown.

Active filters appear as removable chips. Reset clears the report state in one action. Drill-through links preserve the current scope and add the selected day, hour, category or metric.

## Category intelligence

Category cards show revenue, units, receipts containing the category, average item price, share, comparison delta and a sparkline. Selecting a card applies the category to the entire dashboard.

The hourly comparison renders two to five selected categories. The day-of-week by hour heatmap supports revenue, receipts and item quantity. Unknown categories stay visible but are not used for category momentum insights.

There is no trustworthy subcategory in the current normalized source, so no subcategory filter is exposed.

## Product intelligence

The product profile includes:

- revenue and quantity;
- number of distinct days sold;
- average units per selling day;
- peak hour;
- strongest and weakest weekday;
- category revenue share when the category is known;
- change against the comparison period.

The treemap shows category to product contribution by revenue or quantity. Unmapped Evotor products remain identifiable and carry the `Unmapped` status rather than being guessed into the catalog.

## Demand and time

Business timestamps are grouped in `Europe/Moscow` for the current location. UTC is not used as the restaurant-day boundary.

- The primary trend selects hourly, daily, weekly or monthly granularity from the chosen period.
- Hourly demand shows revenue, receipts or units for the selected scope.
- The calendar heatmap shows revenue, receipts or average receipt by business date.
- Weekday/hour heatmap exposes recurring peak and weak hours.
- Configurable dayparts summarize revenue, receipts, units and average receipt.
- Peak hours list the strongest three hours in the current filtered period.

Location-specific timezones are an extension point. The current normalized data has one business timezone, so the server consistently uses Moscow time instead of pretending per-location metadata exists.

## Basket intelligence

Basket analysis uses distinct eligible sale IDs and stable product/source identifiers.

- Basket size groups receipts into 1, 2, 3 and 4+ units.
- Product pairs require at least two co-occurrences.
- Support is pair baskets divided by all eligible baskets in scope.
- Pair strength is the larger of `P(A|B)` and `P(B|A)` for a symmetric pair; the UI explains this instead of presenting it as causality.

The report describes observed co-occurrence, not causation or guaranteed cross-sell performance. It does not merge products by similar names.

## Pareto and ABC

Products are sorted by revenue and assigned a cumulative share. The report shows how many products form 50%, 80% and 90% of revenue.

ABC defaults are:

- A: cumulative revenue through 80%;
- B: through 95%;
- C: the remainder.

Classification is analytical only and never changes the catalog. Thresholds can be configured server-side per location.

## Average receipt and revenue decomposition

Average receipt is decomposed into:

`items per receipt × average item value`

The revenue bridge is arithmetic, not causal. It shows the contribution from receipt-count change, average-receipt change and refund change between selected periods. It does not claim why customer behavior changed.

## Deterministic insights and anomalies

Insights are generated from report values without an LLM:

- material category movement with a minimum receipt volume;
- peak demand hour;
- average-receipt movement;
- unusually high or low latest day.

Product growth/decline rankings also require the configured minimum receipt volume across the current and comparison periods, preventing a one-to-two sale change from appearing as a meaningful momentum signal.

Anomaly detection compares the latest date with up to eight previous observations of the same weekday. It requires sufficient history and flags a deviation beyond the configured standard-deviation threshold. The UI states the rule and links to the underlying filtered data.

## Configuration

Optional server-only `ANALYTICS_CONFIG_JSON` configures dayparts and guardrails. It is keyed by `default` or by location ID and validated with Zod. Invalid configuration safely falls back to defaults.

```json
{
  "default": {
    "dayparts": [
      { "key": "lunch", "label": "Обед", "start": 11, "end": 14 },
      { "key": "evening", "label": "Вечер", "start": 17, "end": 21 }
    ],
    "abcA": 80,
    "abcB": 95,
    "momentumMinReceipts": 3,
    "anomalySigma": 2
  }
}
```

This variable is optional and contains no secret. Defaults require no test-stand environment change.

## Caching and freshness

- Reports containing the current business day use a 30-second cache.
- Historical reports use a 5-minute cache.
- The permission-scope key and all filter inputs are part of the cached arguments.
- Manual refresh and successful Evotor sync invalidate the `karimoff-analytics` tag.
- The UI shows the latest data timestamp and latest successful Evotor sync; data older than ten minutes is marked stale.

No cache result is shared across different location permission scopes.

## UI and chart stack

The hub uses semantic HTML, CSS and small accessible SVG charts already present in KARIMOFF. Expensive report aggregation remains server-side. This avoids introducing a second large chart runtime for visualizations that do not currently require canvas-scale rendering.

Primary trend, hourly demand, weekday/hour heatmap and treemap support expanded mode. Interactive controls are keyboard reachable, tooltips expose contextual values, skeleton/loading states preserve layout, and dense blocks collapse for tablet and mobile.

Apache ECharts remains the preferred extension when future reports genuinely require brush selection, large scatter plots or high-density zoom. It should be dynamically imported behind an analytics-only client boundary rather than added to the ordinary ERP bundle.

## Exports

- The sales journal remains server-paginated and supports streaming CSV for the current filters.
- Product and category reports have separate scoped CSV exports.
- Spreadsheet formulas are escaped.
- Exported reports omit unnecessary customer PII.

## Permissions

- Owner and admin can see all operational analytics.
- Manager access is restricted by `staff_location_access` and fails closed without assigned locations.
- Cook and other unsupported roles cannot access analytics.
- Query scope is applied on the server; UI filters cannot expand a user's allowed locations.

## Performance model

The browser receives aggregates, not raw receipt history. Queries filter by business period and scope before grouping. Existing analytics indexes cover timestamp, source, store, terminal, employee, external ID, product mapping and reconciliation paths.

Materialized views are intentionally not introduced yet. Current report volume does not justify refresh complexity, and short scoped cache handles repeated dashboard reads. Query plans should be reviewed again as the dataset approaches millions of receipt lines.

## TEST_ORDER_MODE

Test orders are marked in the canonical order model and excluded from business analytics. Their KDS lifecycle can reach `ready` and `handed_out` without inventory mutation, bonus accrual, fiscalization or production revenue. The production path still calls the transactional inventory guard and remains strict when stock is insufficient.

## Saved views

The URL is the validated saved-view contract and can already be bookmarked or shared. Persisted named views are deferred until the employee/organization ownership model is finalized; arbitrary unvalidated JSON is not stored.

## Intentionally unavailable metrics

The UI does not show zero-valued placeholders for unavailable food cost or inventory intelligence. The following remain hidden until recipe costs and stock coverage are trustworthy:

- theoretical COGS and food-cost percentage;
- gross profit and contribution margin;
- waste and stock variance;
- days of stock and predicted depletion;
- actual versus theoretical ingredient consumption;
- labor cost, marketing ROAS, LTV and cohorts.

These can be added to the server report contracts without changing the canonical sales identity or double-counting rules.

## Current limitations

- Category coverage depends on confirmed Evotor product mappings.
- Subcategories are not available.
- POS customer identity is usually unknown.
- Category-level payment attribution is unavailable for mixed baskets.
- Statistical observations become meaningful only after enough historical data is accumulated.
- Automatic matching of web orders and POS receipts remains prohibited without a reliable external reference.
