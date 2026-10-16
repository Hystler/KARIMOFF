# Purchase planning coverage repair, 2026-10-16

Branch: `codex/purchase-planning-coverage-fix-20261016`.
Base: `e9d17b0560501977121b159fa70cfce3014851de`, fetched from `origin/main`.
No production code, configuration, schema, inventory, receipts, orders, prices or mappings were changed. No deploy, sync, payment or merge was performed. Publication is limited to committing/pushing this fix branch and opening a Draft PR, as explicitly authorized after verification; `main` remains unchanged.

## Real Read-Only Comparison

Production application 229491 (`karimoff-production`) was on `e9d17b0`.
Both versions were evaluated inside **one REPEATABLE READ, READ ONLY transaction** using the existing runtime role `karimoff_app` and database `karimoff_migration`. Snapshot: `2026-10-16 00:42:50.571685+00`. Credentials stayed in the process environment; no secrets or customer/order identifiers were exported.

The baseline was loaded from the exact base commit, the candidate from this worktree. The baseline sales SELECT was instrumented only with an additional revenue aggregate, without changing predicates, grouping positions or calculation formulas. Both ran with the same transaction-local `jit=off`, bounded statement/lock timeouts, dates, stock and price snapshot. Diagnostic code ran only in a temporary Node process, not a deployed application revision or worker.

History is **28 days**, 2026-09-18 through 2026-10-15, Europe/Moscow; forecast is **30 days**, starting 2026-10-16, plus one buffer day. The original screen used complete weeks, not a 30-day history. The reported RUB 3,188 is reproduced exactly with these options.

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Canonical sold units | 5,407 | 5,407 |
| Canonical item revenue | RUB 1,533,482.00 | RUB 1,533,482.00 |
| Units with usable composition | 207 | 5,063 |
| Composition coverage by units | 3.8284% | 93.6379% |
| Revenue with usable composition | RUB 8,091.76 | RUB 1,519,558.25 |
| Composition coverage by revenue | 0.5277% | 99.0920% |
| Excluded units | 5,200 | 344 |
| Excluded turnover | RUB 1,525,390.24 | RUB 13,923.75 |
| Known-price purchasing recommendation, 30 days + buffer | RUB 3,188.00 | RUB 512,438.80 |

The candidate has 77 SKU/composition groups, 69 usable and eight unresolved, and 39 ingredient demand rows. The original 56 display groups collapsed sizes and ignored snapshots; comparing their group counts directly would be misleading. Previously covered products remain covered. No stock/price/package data is missing in the 39 calculated rows, but the **budget remains partial** because eight compositions are unknown. It is not labelled as a full procurement budget.

The two independently computed canonical quantity/revenue totals equal the resolved input totals. Snapshot/receipt joins do not multiply positions. Returns and canonical sale deduplication retain the existing planning policy: `analytics_included`, `sale_count_eligible`, item `operation_type='sale'`. Refunds do not generate negative demand or reverse actual food usage; financial/refund formulas are untouched.

## Actual Causes Of Missing Coverage

| Original exclusion | Groups | Sold units | Cause and treatment |
| --- | ---: | ---: | --- |
| Incomplete recipe | 18 | 3,508 | All 18 have zero-quantity components. The old `quantity > 0` requirement invalidated the entire recipe. Zero optional rows are now ignored; at least one valid positive component is still required. |
| Variant requires review | 12 | 971 | A size/replacement group excluded every sale of that catalog product. Exact verified store/SKU evidence now selects the portion/replacement; unknown variants still fail closed. |
| Unmapped | 20 | 721 | Planning never used the existing verified identity manifest. 377 units are recovered using its explicit recipe/component identities, including records without `product_id`. The other 344 units stay unknown. |
| Already covered | 6 | 207 | Retained. |

**Chicken shawarma:** product `3669113a-5731-4770-97e2-72581dfc98fa`, slug `shaurma-kurinaya`, has a zero optional cheese-stick row (`657fdd55-7cf8-4ecc-85d3-07a968e311c2`, quantity `0 pcs`). It does not invalidate the seven real tech-card components. Its 1,972 sold units / RUB 504,983.35 now decompose successfully. The imported tech card has 83 g cabbage net (103.75 g gross at 20% waste), 90 g cooked chicken and one lavash per unit. Piece/gram conversion is never inferred.

## Composition Contract

- Reuse the unchanged 41-entry `foodCostIdentityRows()` manifest: exact Evotor store + SKU, original receipt label consistency, supported evidence date, mapping status and explicit catalog slug/ingredient UUIDs. No fuzzy lookup or inference from selling price.
- Confirmed portions must match the existing size option and ingredient/unit, with no other nonzero base ingredient. Confirmed replacements remove the original component exactly once, then insert the verified replacement once.
- Unknown/rejected/conflicting identities, unverified option quantities and compound receipt subpositions/extra keys remain excluded. Merely having the same catalog `product_id` does not prove a historical portion.
- Native `order_item_ingredient_usage` is authoritative, including extras, removals and replacements. Its quantities already contain waste and are not divided by yield again. Missing native snapshots do not fall back to today's recipe.
- Separate composition variants retain separate weekday demand distributions before their ingredients are aggregated. A missing price does not invalidate a known composition; it leaves the budget incomplete.
- Units normalize only within verified families: kg to g, litres to ml, pieces to pieces. Stock, reserves, minima, pack sizes and unit costs normalize together. Duplicate positive recipe components fail closed rather than being double-counted.
- The existing weekday sampling and 1/2/3/7/14/30-day forecast, buffer, reserve, minimum-stock and package-rounding model is retained. Negative stock remains known debt included in the shortfall; no inventory correction is performed.

## Remaining Evidence Required

| Receipt item | Sold units | Revenue, RUB | Required confirmation |
| --- | ---: | ---: | --- |
| Халапеньо | 141 | 5,640.00 | Historical portion and exact ingredient; the web 30 g option is not receipt proof. |
| Картофель фри Доп. | 100 | 3,937.75 | Historical extra portion; do not silently use today's web 50 g. |
| Острый чили соус | 50 | 2,000.00 | Exact ingredient/composition and portion. |
| Лук Фри | 20 | 800.00 | Historical portion; the current web 15 g option is insufficient. |
| Кисло-сладкий соус | 13 | 516.00 | Exact sauce ingredient/composition and portion. |
| Жареный бекон | 12 | 600.00 | Historical portion and verified piece/gram basis. |
| Цезарь соус | 7 | 280.00 | Exact sauce ingredient/composition and portion. |
| Говядина 90гр | 1 | 150.00 | Register this exact additional SKU with ingredient identity and evidence period; the label alone must not become a new implicit mapping. |
| Total | 344 | 13,923.75 | Remains outside ingredient/budget calculation, inside coverage denominators. |

The current production database has **zero `production_recipes` rows**. Existing tech cards use purchased/prepared ingredients such as cooked meat, sauces and patties. There is no confirmed raw-material/batch-yield graph to expand these further. They stay explicit ingredient demand, not invented raw meat or duplicate production inputs. A raw-material procurement plan for manufactured intermediates needs owner-confirmed production recipes, yields, units and output-stock handling as a separate extension of the existing production model.

Prices are the existing positive **current recorded procurement unit prices**, not assumed selling margins or reconstructed historical invoices. Zero/null prices remain unknown. The old temporary price examples in `docs/food-cost-inputs-2026-09-01.md` are not copied into the calculation: current recorded lettuce/sauce prices differ from those old estimates. Invoice verification and dated COGS are not claimed.

## UI And Evidence

The planning component now uses scoped CSS and existing `--admin-*` semantic tokens. It separately shows quantity/revenue coverage, partial-budget status, excluded units/turnover, reserves, target with buffer, shortage, pack size/count and the exact per-unit gross composition. Unknown products keep their sales forecast but do not contribute an invented ingredient requirement. There is no global redesign or change to POS/KDS.

Local, ignored evidence (aggregate data only, JSON/CSV mode `0600`):

- `outputs/planning-20261016/real-comparison.json`: same-snapshot before/after, ingredient recommendations, all SKU/composition diagnostics and the zero-component proof.
- `outputs/planning-20261016/product-diagnostics.csv`: 77 rows with sold quantity, revenue, old status, stable SKU/catalog ID, mapping status, recipe availability, decomposition source, exclusion reason and sales forecast.
- `outputs/planning-20261016/after-{light,dark}.html`: actual component rendered locally with the same anonymized aggregates; no business APIs or database connections in the UI harness.

This fix is prepared for review, **not a deployed correction**. Financial views, the existing food-cost resolver/identity manifest, prices, recipes, inventory, fiscalization and payment code remain unchanged.

## Verification

- Final `npm run lint`, `npm run typecheck`, `npm run build` and `git diff --check`: **PASS**; lint has zero errors/warnings. No production database connection was used by these local checks.
- Relevant planning, canonical analytics, food-cost identities, inventory scope, production accounting and staff-session tests: **93 passed, zero failed, zero skipped**, including real PostgreSQL 17 checks on disposable loopback databases.
- Full repository suite: **560 tests, 517 passed, zero failed, 43 skipped**. The skips are existing opt-in checkout, delivery, POS and YooKassa database suites requiring their own disposable fixture profiles; they are not claimed as executed by this task. All planning tests, including the new PostgreSQL join test, ran.
- Initial broad-suite attempts used an unsuitable generic RC fixture and then a C/C-collation database for an existing Cyrillic case-fold test. These fixture errors were corrected by using the existing UTF-8 RC database for food-cost checks and the isolated planning database for planning checks. No unrelated test, financial resolver or transaction code was changed to hide failures.
- Canonical SQL integration covers Moscow boundaries, excluded/return records, native snapshots, receipt source identities and deliberately colliding UUIDs between source namespaces. Unit tests cover all 41 verified identities, zero optional components, unsupported variants, replacements, unknown prices/stock/packages, negative stock, reserves, unit normalization and package rounding.
- Browser checks used the actual planning component rendered with the same anonymized production aggregates, not a production modification. Light/dark at 390, 768 and 1440 px, plus 125% layout/DPR equivalents, produced **12 states with no page-level horizontal overflow**. Wide tables scroll within their own labelled, keyboard-focusable containers.
- The 390 px / 125% check exposed the existing global 320 px body minimum. A page-local `body:has(.plan)` override removes that minimum only when this component is present. No shared global stylesheet was changed.
- Measured minimum text contrast: **4.79:1 light / 6.95:1 dark**; warning text: **6.12:1 / 9.20:1**. Filters have 44 px targets. Keyboard navigation, visible focus, row hover and composition expansion were checked. The 125% checks are browser layout/device-pixel-ratio emulation; native Chrome menu zoom was not verified while macOS was locked.
- Screenshots: `outputs/planning-20261016/after-dark-1440-100.png`, `after-light-1440-125.png`, `after-dark-390-100.png`, `after-light-390-125.png`.

Review found no business write path, broadened location scope, migration, secret, generated output intended for Git, or changes to canonical financial formulas. `origin/main` was fetched again and remained at the recorded base. Remaining business work is limited to confirming the eight historical compositions above, raw-material/yield cards for intermediates if required, and procurement price evidence where current ledger prices are not enough.

Final pre-publication review reconfirmed the seven-file scope and unchanged base. No critical/high/medium code defect was identified. The owner explicitly accepted the unverified native Chrome 100%/125% zoom as non-blocking; browser emulation results above are not relabelled as native zoom verification. Ignored local aggregate evidence, screenshots, HTML previews and diagnostic scripts are excluded from the commit.
