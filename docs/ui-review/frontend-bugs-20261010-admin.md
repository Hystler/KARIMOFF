# Admin diagnostics — 2026-10-10

Base: `89d1002`, branch `codex/frontend-menu-profile-fixes-20261010`.

## Overview: revenue and queue

Confirmed source mismatch: `src/app/admin/page.tsx` previously computed “Выручка сегодня” by summing non-cancelled rows from `public.orders` created today. Imported Evotor receipts exist in canonical sales, not in native orders. The sum could therefore be zero while analytics had sales; it also counted unpaid orders as revenue.

The revenue tile now reads `canonical_analytics_sales` with the existing `analytics_included` predicate, net revenue and `sale_count_eligible` count, using the same Moscow calendar-day bounds and staff location scope as analytics. The count is labelled “продаж · МСК”. This changes a read projection; payment, fiscal, order creation and analytics membership rules are unchanged.

A query failure now appears as unavailable (`—` plus an alert), rather than a convincing zero. Order/KDS tiles also show `—` when their order source failed.

“В работе” and “На кухне” remain operational native-order metrics. Imported historical receipts cannot create a live kitchen queue. Existing filters exclude non-operational orders, closed/cancelled orders and stale prior-day active tickets. The read-only production query below confirmed that the current zero active/cooking metrics are legitimate; these filters were preserved.

Read-only production evidence obtained via the existing authenticated Timeweb console on **2026-10-10 at 13:35:47.915Z** (`transaction_read_only = on`):

- Today's canonical `pos_evotor` sales: **62 sales, 35,950 ₽ net revenue**. Native-order-only revenue therefore missed real cash-register sales.
- Real operational native orders are only `cancelled` (3) or `handed_out` (11), latest created 2026-06-06. No real active or cooking operational order exists.
- Other native orders include non-operational cancelled/handed-out history. A site ticket with `cooking` was created 2026-07-30 and is non-operational; it cannot create a current kitchen count. Test tickets are old cancelled/handed-out history.
- Latest canonical POS sale at this observation: 2026-10-10T13:33:06Z; latest source synchronization 13:35:27Z. A zero revenue tile is not explained by an empty today's sale source.

Exact requested home products were checked in the same production read-only channel; all are active:

| Product / exact slug | Current price | Net quantity in 30 days | Net revenue in 30 days |
| --- | ---: | ---: | ---: |
| Chicken shawarma / `shaurma-kurinaya` | 260 ₽ | 2,202 | 564,523.35 ₽ |
| Tyson / `tayson` | 430 ₽ | 120 | 51,535.50 ₽ |
| Chicken roll / `chicken-roll` (exact mapped SKU only) | 280 ₽ | 0 | 0 ₽ |
| Beef flatbread shawarma / `shaurma-v-lepeshke-govyadina` | 460 ₽ | 62 | 28,428 ₽ |

The period is 2026-09-11 through 2026-10-10 inclusive, Moscow time (end exclusive 2026-10-11 midnight). A zero for `chicken-roll` is the exact mapped SKU result, **not evidence that chicken roll had no sales**. The raw receipt-name check found `Чикен ролл`: **18 item rows, net quantity 19, net revenue 5,250 ₽**, `product_id = null`, `mapping_status = unmapped`. These receipts do not appear under the mapped storefront SKU. A confirmed recipe-equivalent mapping requires evidence; no mapping was assumed or written. This home order follows the user's explicit selection; these values do not justify claiming all four are sales leaders. Real hot-dog products already use raw category `Хот-Доги`.

## Food-cost coverage

Confirmed arithmetic error: coverage used `abs(sum(covered signed revenue)) / sum(abs(all revenue))`. A fully costed sale of 1000 and fully costed return of 20 therefore appeared as 96.08%, although no costing was missing.

Coverage now uses `sum(abs(covered revenue)) / sum(abs(all revenue))`. Signed covered revenue, recipe costs, profit, sale/refund counts and exclusions remain unchanged. The regression test proves full coverage across a sale/return pair and partial coverage when the return is unknown. Existing PostgreSQL regression additionally checks the absolute covered aggregate when an explicit disposable local DSN is provided.

The arithmetic issue is demonstrated by a local regression case. It does **not** explain the measured current production period below: old and corrected percentages are identical there. Missing price, unit mismatch, missing native usage snapshot, unconfirmed mapping or ambiguous portion still correctly reduce coverage. Procurement prices were not invented or changed.

The current production read-only query used the exact `SALE_FOOD_COST_JOIN` resolver for **2026-09-11 through 2026-10-10 inclusive, Moscow time**, with `transaction_read_only = on`:

- Initial read: 4,622 included item rows; 3,574 cost-covered rows; absolute turnover **1,631,886.50 ₽**; old and corrected coverage both **86.0554%**.
- A subsequent read included one additional covered sale: **4,623 item rows / 3,575 covered**, absolute turnover **1,632,666.50 ₽**; old and corrected coverage both **86.0621%**.
- Uncovered absolute turnover remained **227,559.37 ₽** across both snapshots.
- **26** uncovered product/source/reason groups. The table below lists the complete grouping captured by the subsequent read. Counts reflect item rows, not units.
- Active products with missing or invalid base recipe prices/units: **0**. A complete active base recipe does not prove the identity of an imported historical portion or an unmapped receipt item.

| Imported receipt position | Rows | Uncovered absolute turnover | Resolver exclusion |
| --- | ---: | ---: | --- |
| Картофель фри | 242 | 64,281 ₽ | Unresolved receipt portion |
| Сырные палочки | 72 | 27,126 ₽ | Unresolved receipt portion |
| Королевские креветки | 51 | 25,720 ₽ | Unresolved receipt portion |
| Наггетсы | 63 | 17,547 ₽ | Unresolved receipt portion |
| Картофель по-деревенски | 49 | 14,213.34 ₽ | Unresolved receipt portion |
| Крылышки барбекю | 29 | 12,807.50 ₽ | Unresolved receipt portion |
| Мини шаурма | 61 | 12,708 ₽ | Unmapped product |
| Биф ролл | 27 | 11,215.28 ₽ | Unmapped product |
| Татарин | 7 | 6,993 ₽ | Unmapped product |
| Халапеньо | 132 | 6,120 ₽ | Unmapped product |
| Чикен ролл | 18 | 5,250 ₽ | Unmapped product |
| Картофель фри доп. | 90 | 4,377.75 ₽ | Unmapped product |
| Чикен бургер | 15 | 4,000 ₽ | Unmapped product |
| Котлета из говядины | 12 | 3,341 ₽ | Unmapped product |
| Ломтик сыра | 57 | 3,274 ₽ | Unmapped product |
| Курица 90гр | 21 | 3,048 ₽ | Unmapped product |
| Острый чили соус | 42 | 2,000 ₽ | Unmapped product |
| Лук фри | 14 | 994 ₽ | Unmapped product |
| Кисло-сладкий соус | 17 | 676 ₽ | Unmapped product |
| Жареный бекон | 9 | 442.50 ₽ | Unmapped product |
| Лаваш | 6 | 425 ₽ | Unmapped product |
| сырные палочки | 6 | 400 ₽ | Unmapped product |
| Цезарь соус | 5 | 280 ₽ | Unmapped product |
| Свинина 90гр | 1 | 130 ₽ | Unmapped product |
| Сырные палочки | 1 | 100 ₽ | Unmapped product |
| Добрый Апельсин, 0,33 л | 1 | 90 ₽ | Invalid native ingredient snapshot (`web`) |

The first 25 groups above are imported `pos_evotor` rows; only the final beverage group is native `web`. `Сырные палочки` with unresolved portion (72 rows), lowercase `сырные палочки` with unmapped product (6 rows), and `Сырные палочки` with unmapped product (1 row) remain distinct source-name/reason groups. They were not merged or assigned guessed aliases. Mapping identity and historical portion evidence are still required before changing these records.

The full 26-group table was reconciled against the raw console screenshot: row counts total **1,048**, matching `4,623 − 3,575`, and row amounts total **227,559.37 ₽**, exactly matching the SQL aggregate. A manual transcription error in `Картофель фри доп.` was corrected from 4,737.75 ₽ to the verified **4,377.75 ₽**; the exact imported wing name was verified as `Крылышки барбекю`. Coverage percentages above come from the SQL aggregate.

The observed **96%** therefore remains unreproduced for this period. Obtain the user's original analytics period, filters and screenshot before explaining that value. Historical portion identity and recipe-equivalent product mapping must be established from source evidence; price/name similarity does not justify guessing portion size, unit quantity, ingredient or procurement price. No production costing data was changed.

## Repeated staff login

Not reproduced with available evidence. Admin, POS and KDS already call the same `getCurrentStaff()`, read the same HttpOnly cookie with `path: "/"`, and accept owner/admin through existing permission guards. Session expiry and revocation are checked against database state on each read; active staff is required. No authorization checks were relaxed, no session lifetime changed, and no role was fabricated.

Behavioral local tests exercise repeated authenticated reads for owner/admin and POS/KDS permissions, and reject expired/revoked sessions. They cannot validate a production cookie or production authorization. To resolve a production incident, capture failing path/redirect, host/protocol, session validity/revocation and sanitized session-query SQLSTATE under an existing authorized session; never export tokens or credentials.

## Real-data access and limits

- No database/PG/Timeweb variables were present in the local execution environment; root/worktree contain only `.env.example`.
- SSH config exposes no configured production host alias.
- Existing `~/.codex/handoffs/KARIMOFF` and committed release evidence are dated 2026-10-03/05. They prove earlier Timeweb console work, not current counts or sales.
- No production data or env was changed. No real order/payment was created. No migration, merge or deploy was performed.
- The parent task obtained current read-only DB evidence through the already authenticated Timeweb production console, using bounded `BEGIN READ ONLY` queries and `ROLLBACK`. Production credentials remain inside that process; local env files were not created or changed. This console authorization does not verify production web-app staff-session behavior.

## Local verification

`node --test tests/admin-overview-sales.test.mjs tests/staff-navigation-session.test.mjs tests/analytics-sale-food-cost.test.mjs tests/analytics-economics-regression.test.mjs tests/analytics-food-cost-product-composer.test.mjs`: **30 passed, 0 failed, 1 skipped**. The skipped SQL regression requires `FOOD_COST_TEST_DATABASE_URL` for a disposable local PostgreSQL; it never falls back to production `DATABASE_URL`.

Scoped ESLint and `git diff --check`: passed. Final branch-wide typecheck/build are recorded in the parent task's report.
