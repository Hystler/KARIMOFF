# Sale Food Cost Audit

## Scope

Only these files belong to this change:

- `src/lib/analytics/dashboard.ts`
- `src/lib/analytics/sale-food-cost.ts` (new)
- `tests/analytics-sale-food-cost.test.mjs` (new)
- `docs/analytics-sale-food-cost-audit.md` (this note)

No changes to payment/revenue rules, source views, order creation, portions, existing tests, other libraries, schema, or application data.

## Root Cause And Fix

Both the overview and product aggregates multiplied sale quantity by the current base-product recipe cost. That treated a selected 12-piece portion as the 6-piece base recipe, and ignored extras/removals.

Both aggregates now use the same `SALE_FOOD_COST_JOIN` resolver:

1. Native item provenance is `analytics_sale_items.source = 'web'`, including native POS/kiosk orders whose canonical sale channel is `pos_evotor`. Join usage on `i.source_record_id = usage.order_item_id`; never parse compound IDs or infer provenance from `s.source`.
2. Aggregate usage to one row per item before joining the dashboard result. Unit food cost is `sum(quantity_per_item * current ingredient.cost_per_unit)`; the existing canonical `i.net_quantity` multiplier stays unchanged.
3. Usage already includes waste from `apply_ingredient_waste_to_order_usage()`. Do not apply current waste a second time. Current recipe quantities do not override snapshots.
4. Missing native snapshots, missing/zero/null ingredient costs, unit mismatches, or negative usage produce unknown cost. No base-recipe fallback, including for legacy native items without a snapshot. These rows reduce cost coverage; product cost/profit stays unavailable when its group is incomplete.
5. Imported Evotor items may use a complete base recipe only with a confirmed product mapping and no configured `Размер порции` group. Such a group makes portion identity ambiguous; no price/name-based guessing is attempted. Retired groups remain a conservative exclusion because historical receipt mappings carry no portion identity.
6. Base recipe completeness now uses a left join and null-safe validation, so a missing ingredient or null cost cannot silently disappear from `bool_and`.

Native items with a null product ID remain outside coverage, preserving the existing unmapped-item rule. A genuinely empty ingredient snapshot cannot be distinguished from an absent one and stays unknown. An existing snapshot is trusted as the order-creation contract; this change does not reconstruct or repair historical snapshots.

Revenue expressions, canonical sale membership, net sale/refund quantities, and payment semantics are unchanged. Only food-cost eligibility affects the existing covered-revenue/profit metrics.

## Verification

```sh
npm run typecheck -- --incremental false
npx --no-install eslint src/lib/analytics/dashboard.ts src/lib/analytics/sale-food-cost.ts tests/analytics-sale-food-cost.test.mjs
FOOD_COST_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/karimoff_audit node --test tests/analytics-sale-food-cost.test.mjs tests/analytics-food-cost-product-composer.test.mjs tests/analytics-economics-regression.test.mjs tests/unified-analytics.test.mjs
git diff --check -- src/lib/analytics/dashboard.ts src/lib/analytics/sale-food-cost.ts tests/analytics-sale-food-cost.test.mjs
```

Result: typecheck, scoped ESLint, diff whitespace checks, and all 35 tests passed, including the PostgreSQL regression test (no skips).

The PostgreSQL test uses a reserved connection, `BEGIN READ ONLY`, and `ROLLBACK` in `finally`. It captures the actual two dashboard queries, checks them against the migrated schema with `EXPLAIN` (not `ANALYZE`), then substitutes all table references with synthetic JSON-backed CTEs. It performs no inserts, temporary table creation, schema changes, or application-data writes. The PG test is skipped unless its explicit local-only DSN variable is supplied; it never reads `DATABASE_URL` or an environment file.

Regression cases cover:

- 6/12 pieces at current cost 14.4: 86.4/172.8, combined product cost 259.2.
- Ingredient repricing doubles cost without changing quantity or revenue.
- Extras and removals; multiple ingredient rows do not duplicate sales.
- Snapshotted waste is not applied twice; changed base recipes do not replace snapshots.
- Missing/invalid snapshots and partial product coverage.
- Native POS provenance and imported/native source-record ID collisions.
- Confirmed fixed-recipe Evotor sales/returns, unmapped and suggested mappings, active/retired portion ambiguity.
- Original product quantities, receipt counts and revenues remain unchanged.

The supplied local database is shared with other fixture work; this audit does not modify or clean up anyone else's records. No commit, deployment, or production access.
