# Verified Evotor food-cost coverage, 2026-10-10

Branch: `codex/food-cost-coverage`.
Base: `89d10027ab039d354986506f959f0274fe4d258e`.
No migration, receipt backfill, sync job, production write or deploy is required/performed.

## Before / after

Period: 2026-09-11 through 2026-10-10, Europe/Moscow.
Comparison cutoff: `2026-10-10T13:35:47.915Z`.
Both resolvers were evaluated against the same current canonical sale views using
`BEGIN READ ONLY`, a bounded statement timeout and `ROLLBACK`.
Only `analytics_included = true` sales were counted; coverage uses absolute item
net revenue, so returns do not disappear from the coverage denominator.

| Metric | Existing resolver | Proposed resolver |
| --- | ---: | ---: |
| Canonical item rows | 4,618 | 4,618 |
| Rows with calculable cost | 3,570 | 4,308 |
| Absolute item turnover, RUB | 1,630,096.50 | 1,630,096.50 |
| Unknown turnover, RUB | 227,559.37 | 14,980.25 |
| Covered turnover | 86.0401% | 99.0810% |
| Previously covered rows lost | - | 0 |

The earlier audit had 4,623 rows / RUB 1,632,666.50 / 86.0621% coverage.
Its unknown turnover is reproduced exactly, but its full denominator is not an
immutable database snapshot. Do not mix the two denominators when reporting improvement.
The additional verified turnover is RUB 212,579.12 across 738 rows.
These are read-only results for the proposed code, not an already deployed fix.

| Newly calculable group | Rows | Turnover, RUB | Evidence |
| --- | ---: | ---: | --- |
| Fries 150/200 g | 242 | 64,281.00 | Two receipt SKUs, explicit portion, matching ingredient/option |
| Cheese sticks 6/12 pcs | 72 | 27,126.00 | Two receipt SKUs, explicit portion, matching ingredient/option |
| Breaded shrimp 6/12 pcs | 51 | 25,720.00 | Two receipt SKUs, explicit portion, matching ingredient/option |
| Nuggets 6/12 pcs | 63 | 17,547.00 | Two receipt SKUs, explicit portion, matching ingredient/option |
| Potato wedges 150/200 g | 49 | 14,213.34 | Two receipt SKUs, explicit portion, matching ingredient/option |
| BBQ wings 8/16 pcs | 29 | 12,807.50 | Two receipt SKUs, explicit portion, matching ingredient/option |
| Mini shawarma, beef roll, Tatarin, chicken roll, chickenburger | 128 | 40,166.28 | Five exact receipt SKUs to catalog slugs and existing recipes |
| Chicken/pork 90 g, cheese slice, single cheese stick, beef patty, lavash | 104 | 10,718.00 | Six exact receipt SKUs to ingredient UUIDs and explicit quantities |
| Total | 738 | 212,579.12 | No name similarity / retail price inference |

## What remains unknown

| Receipt item | Rows | Turnover, RUB | Missing evidence |
| --- | ---: | ---: | --- |
| Jalapeno | 132 | 6,120.00 | Actual historical portion; web option grams alone are not receipt evidence |
| Extra fries | 90 | 4,377.75 | Actual historical portion; do not assume the web 50 g option |
| Spicy chili sauce | 42 | 2,000.00 | Exact sauce identity/composition and portion |
| Fried onion | 14 | 994.00 | Historical portion; do not assume the web 15 g option |
| Sweet-and-sour sauce | 17 | 676.00 | Exact ingredient and historical portion |
| Fried bacon | 9 | 442.50 | Historical portion and confirmed piece/gram conversion |
| Caesar sauce | 5 | 280.00 | Exact ingredient/composition and historical portion |
| Dobry Orange 0.33 L, native order | 1 | 90.00 | Verified procurement cost and native usage snapshot |
| Total | 310 | 14,980.25 | Remains unknown, never zero-cost |

Read-only checks found no usable positive procurement price for Dobry drinks:
current ingredient unit costs are zero, package prices are null, and Evotor cost
fields do not supply a verified price. No beverage price was invented.
Next evidence needed: supplier invoice/package size for drinks and owner-confirmed
historical portions/ingredients for the seven remaining extras/sauces. Confirmation
of today's web option must not be silently applied to past receipts.

## Identity and history rules

`data/analytics/evotor-food-cost-identities.json` has 41 explicit, unique SKUs:
12 portion identities, 5 recipe identities, 6 component identities and 18 meat
replacement identities. All 41 SKU/label/store combinations were verified against
existing real receipt items on 2026-10-10, without customer or fiscal payload export.

- Identity scope is the exact Evotor store and product SKU, not the display name.
- Catalog slugs identify recipes; ingredient UUIDs identify components/replacements.
- Original receipt labels are exact consistency guards (trim/case only), not fuzzy keys.
- Rules apply from 2026-09-11, the period supported by the existing recipe evidence.
- Collapsed analytic names do not contain the portion, so read the original receipt
  item using the canonical item's `source_record_id` instead.
- Portion/replacement rules require the existing confirmed catalog mapping and a
  matching modifier option (ingredient UUID, quantity and unit).
- Portions reject additional nonzero recipe ingredients; zero-quantity optional
  ingredients in the actual catalog do not alter the sold composition.
- Replacement cost subtracts the exact original ingredient and adds the explicit
  replacement once. Conflicting mappings, rejected identities, unknown compound
  subpositions/extra keys and missing/zero ingredient prices remain unknown.
- Unregistered variant SKUs do not fall back to the base portion or guessed meat.
- Native web/POS order snapshots remain authoritative; missing native usage is not
  reconstructed from today's recipe. Quantity/return signs and canonical sale
  deduplication are unchanged. Waste is applied once.
- The resolver computes history during reads. Receipt records, product mappings,
  orders, inventory and purchase data are not rewritten.

Composition sources: original receipt SKU/label/unit snapshots; current explicit
modifier options; owner tech cards described in `docs/tech-card-import-2026-08-11.md`,
including the owner's 2026-09-11 confirmation of the 110 g beef patty;
`docs/extras-catalog.md`; `docs/food-cost-inputs-2026-09-01.md`.
Cheese slices/lavash use pieces, not an unverified mass conversion; bacon remains unknown.

## Cost limitations

Coverage means a supported SKU/portion/composition can be calculated using current
ingredient prices and existing recipe assumptions. It is not proof of historical
invoice-based COGS. Existing temporary sauce/salad estimates and waste coefficients
are documented in the input/tech-card documents and have not been upgraded to
verified procurement facts by this change. Dated purchase-cost accounting is separate.
The dashboard's existing net profit/coverage formulas are not redefined here;
the before/after table above explicitly reports absolute-turnover coverage.

## Verification

- Targeted PostgreSQL tests use loopback PostgreSQL 17 and read-only synthetic CTEs,
  never application tables or production credentials.
- All 41 identities, portion changes, exact substitutions, return signs, native
  source isolation, wrong store, reused/unknown SKU, conflicting labels, rejected
  mappings, nested extras, zero/null prices and unit mismatches are exercised.
- A changed nonzero portion composition becomes unknown; a zero optional line does not.
- Dashboard and intelligence aggregates accept verified component/recipe identities
  even when the imported item has no catalog `product_id`.
- Full-suite PostgreSQL skips outside these targeted tests require their own
  disposable integration schema/credentials. They are not claimed as executed.

Final checks: lint PASS; typecheck PASS; Next.js build PASS; full suite
452 PASS / 0 FAIL / 43 SKIPPED; targeted resolver/identity suite 7 PASS / 0 FAIL /
0 SKIPPED (including both PostgreSQL tests); `git diff --check` PASS.
Review: no migration, runtime data write, guessed retail-price cost, customer export,
dependency change or native order snapshot fallback. Unsupported costs fail closed.

Before release: review this diff and merge through the normal controlled process.
No production SQL or automatic deployment is part of this task.

## Integration on current main

Integration branch: `codex/food-cost-integration`.
Integration base: `c99c4fc073ef154e699b856bf65494a5447ed3b5`.
Source fix: `5e9de6791608f299ced93cbfa535ec6986743dfc`.

The current-main and integrated resolvers were compared again against the real
database in one `REPEATABLE READ READ ONLY` transaction, followed by `ROLLBACK`.
Both used `analytics_included = true` and identical `analytics_at` bounds:
`2026-09-10T21:00:00Z` inclusive to `2026-10-10T13:35:47.915Z` exclusive.
All figures in the before/after and remaining-unknown tables were reproduced:
4,618 distinct items on each side, RUB 1,630,096.50 turnover, coverage
86.0401% -> 99.0810%, RUB 14,980.25 still unknown, and zero previously covered
rows lost. No receipt/customer export, sync or database mutation was performed.

Frontend's absolute-turnover coverage and signed gross-profit calculation are
preserved. The added `covered_absolute_revenue` aggregate uses the same completeness
filter as food cost, including verified SKU identities with no catalog product ID.
Keeping its old product-ID requirement would incorrectly omit these identities
from the coverage numerator after an otherwise conflict-free cherry-pick.

Integration checks: 53 targeted analytics/economics tests PASS, zero failed/skipped,
including both PostgreSQL resolver tests on disposable loopback PostgreSQL 17.10.
The local database contains only an empty plan-check schema and synthetic CTEs,
not production rows. Its ICU UTF-8 locale supports Russian case-insensitive label
guards. Refund signs, recipe/component refunds without product IDs, conflicting
recipe mappings, portion sizes and single-application waste are covered.
Lint, typecheck and `git diff --check` PASS. Full build, Docker and unrelated
integration suites were not rerun for this integration.
