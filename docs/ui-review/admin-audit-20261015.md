# Admin review, 15–16 October 2026

Base: `origin/main = 47d0d54ac661ba0fb1729c3f8e0ab3959b10aaf3`.
Branch: `codex/admin-audit-fixes-20261015`.

Reviewed the existing `docs/ui-review/` reports, the merged frontend and food-cost
changes, semantic admin tokens and the existing analytics/planning architecture.
This is an admin UI/read-path change. No production deploy, env/DB changes,
migrations, orders, payments, inventory correction or notification sends.

## Confirmed defects and changes

| Finding | Cause | Change |
| --- | --- | --- |
| Light warning/success surfaces in dark admin | The old global bridge covered white and selected cream backgrounds, but not status utilities or module-local hardcoded colours | Semantic success/warning/danger/info/accent pairs; bridge scoped to the admin workspace; module styles consume those tokens |
| Inconsistent selected/hover states | Fulfillment selector used an unthemed emerald background; secondary buttons and table rows had independent hover colours | Theme-aware selected, hover and focus states; disabled semantics retained |
| Product status wraps inside “Активен” | Global anywhere wrapping plus a narrow table cell | Explicit nonshrinking, nonwrapping product status in mobile cards and desktop table |
| Cookies dates/statuses/IDs become unreadable | Auto table column sizing and no minimum status/date width | Fixed column tracks, complete wrapping IDs/URLs, nonwrapping dates and badges, labelled keyboard-focusable internal scroll region |
| Recipe editor/settings have pale panels | Alpha cream backgrounds remained light in dark mode | Local semantic inset surface, without changing form fields or save actions |
| Inventory/production labels have low contrast | Module-local grey and fixed pale status colours | Text/surface tokens, including expanded forms; readable dark text on orange primary controls |
| Analytics repeats expensive work | Main dashboard and all-history filter options were uncached; delivery summary started only after the dashboard finished | Scoped/tagged caches and parallel independent summary loading |
| Planning rejects 30 days | Horizon list and maths guard stopped at 14 | One shared 1/2/3/7/14/30 list, 37-day maximum horizon+buffer boundary tested |
| Negative stock becomes “unknown” | Nonnegative numeric validator was also used for signed recorded stock | Signed known balance, visible deficit/history link, procurement recommendation covers stock/reservation debt; unknown stock stays unknown |
| Variant sales inherit a base recipe | Planning grouped only by product, without evidence of the historical portion/modifications | Unresolved portion/replacement/customized composition is explicitly excluded from ingredient demand and coverage; verified base rows remain separate |
| Delivery preview lacks real streets | Static local-projection SVG | Leaflet 1.9.4 map with OSM tiles, pan/zoom, centre, radius and original excluded GeoJSON; no change to address validation |

Production financial SQL, revenue/refund/dedupe predicates, prices, inventory
writes and `management-result.ts` are unchanged. The procurement recommendation
is still read-only; it does not create a supplier order or stock movement.

## Visual evidence

Baseline: 29 routes × 2 themes × 5 widths = 290 captures. Final matrix:
34 routes × 2 themes × 5 widths = 340 captures, with targeted recaptures after
the final local fixes. Widths: 390, 430, 768, 1024, 1440 px.

Covered overview, order history, menu/list/new/edit, ingredient/list/extras/prices/edit,
inventory/movements, production/list/new/edit, customers/list/detail, economics,
all four analytics pages, delivery addresses/zone, Evotor settings, loyalty,
notifications, leads, vacancies/new, staff, settings, Cookies and ERP/kitchen aliases.
All navigations completed with HTTP 200 (including followed aliases); no browser
runtime exceptions or document-level horizontal overflow. Wide data tables retain
intentional internal horizontal scrolling.

| Example | Before | After |
| --- | --- | --- |
| Cookies, dark 390 | [before](screenshots/admin-20261015/cookies-dark-390-before.png) | [after](screenshots/admin-20261015/cookies-dark-390-after.png) |
| Economics, dark 1440 | [before](screenshots/admin-20261015/economics-dark-1440-before.png) | [after](screenshots/admin-20261015/economics-dark-1440-after.png) |
| Product recipe, dark 1024 | [before](screenshots/admin-20261015/product-new-dark-1024-before.png) | [after](screenshots/admin-20261015/product-new-dark-1024-after.png) |
| Delivery map, dark 1440 | [before](screenshots/admin-20261015/delivery-map-dark-1440-before.png) | [after, real tiles](screenshots/admin-20261015/delivery-map-dark-1440-after.png) |

The baseline initially used font fallbacks while Google Fonts was unavailable;
final captures used the downloaded fonts. Typography was not changed. All
displayed customer/order data is synthetic and local. Matrix JSON, full captures,
contrast/state checks and measurement scripts are in ignored
`outputs/admin-review-20261015/`.

Computed visible text contrast in the corrected admin areas meets 4.5:1 for
normal text and 3:1 for large text. Selected/hover/focus were checked on controls,
and expanded inventory/production forms were checked. The legacy embedded KDS
small counters/label remain a separate contrast issue (approximately 2.5–4.1:1).
Their operational component/styles were deliberately left unchanged.

## Analytics measurements

Native isolated PostgreSQL 17, 5,000 synthetic receipts / 10,000 positions, the
same 30-day cut for source-before/source-after. No production credentials used.

| Measurement | Before | After |
| --- | ---: | ---: |
| First source calculation, actual SQL | 538 ms / 36 queries | 501 ms / 36 queries |
| Repeated source calculation, serialized cache harness | 305 ms / 26 queries | 0.13 ms / 0 queries |
| Real Next HTTP, cold cache | — | 1,128 ms / 36 analytical statements |
| Real Next HTTP, next two requests | — | 495 / 419 ms; 0 analytical statements each |

The HTTP checks counted executed statements in the disposable PostgreSQL log,
not merely mocked calls. Four authorization statements still execute on warm
requests. Original financial KPI objects match after the change on the identical
fixture. The source calculation's non-query interval was about 28 ms before and
22 ms after; repeated SQL/planning dominates this dataset, not arithmetic.

Bounded local `EXPLAIN (ANALYZE, BUFFERS)`: food-cost aggregate 121 ms execution
/ 4.9 ms planning; product aggregate 68 / 5 ms; intelligence product aggregate
76 / 4.7 ms; revenue aggregate 18 / 8.9 ms; filter options sample 18 / 0.8 ms.
No JIT in those plans. Concurrent call durations also include pool queueing and
must not be presented as individual SQL execution time.

Current-day dashboard: 30 s revalidation; historical dashboard: 300 s; filter
options: 60 s; delivery summary: 30 s. The existing Refresh action and import
invalidation tag apply to all new caches. Complete filters and freshly resolved
staff scope are cache arguments. Date objects and sync-staleness are restored
outside the serialized cache. No auth/session lookup is cached by this patch.

Cold requests still perform the full calculation. Local figures are not a claim
of production latency. The available production browser redirected to staff
login; exact production SQL/RTT/CPU profiling remains unverified. Use a bounded,
authorized read-only profile before proposing indexes, view changes or a new
aggregation architecture.

## Customers and procurement

`/admin/analytics/audience`, `/admin/analytics/planning` and `/admin/customers`
are present. Added a “Сегменты клиентов” entry from the customer list and a direct
“План закупок” sidebar entry for owner/admin. Existing managers keep scoped
audience access; procurement remains restricted because inventory is global.

Segments currently show aggregates, not named lists. Minimal follow-up proposal:
make a segment navigate to the same audience route with `segment=loyal`,
`returning`, `at_risk` or `sleeping`, preserving the selected report filters
and as-of date. Resolve it server-side with the existing segment classifier,
canonical identified `customer_id`, included sales and freshly checked location
scope. Show name, eligible order count and last purchase. Do not link managers to
an unscoped global customer list, or infer identities for anonymous POS sales.
This drill-through is a proposal; no new CRM permission model was added.

Negative inventory is allowed by the existing schema; reservations/minimums are
nonnegative. History already links ingredient → movement → order/production run
when present. A negative balance can reflect omitted receipts/opening stock or
recorded consumption; the exact cause must be established from actual history.
No production inventory history was read without a valid staff session and no
real balance was corrected. Recommendations explicitly require that review.

Unknown stock, missing prices, incomplete recipes and unmapped POS positions
remain visibly incomplete. Unconfirmed variants reduce forecast coverage rather
than borrow an assumed base quantity. Future evidence-based variant/snapshot
decomposition is separate work.

## CAPEX and map decisions

[CAPEX/depreciation proposal](capex-depreciation-proposal.md) separates the
existing cash outflow from a proposed per-asset monthly depreciation schedule.
Owner decisions on assets, useful lives, residual values and start convention
are required before any new profit formula is wired into the calculator.

The map retains original centre/radius/polygons and the manual aerodrome-review
warning. It is a visualization only. Leaflet loads dynamically; its map and
ResizeObserver are cleaned up on unmount. Initial view makes one set of tile
requests. A local real-network smoke loaded 12 street tiles, verified the
coloured radius/exclusion canvas and zoom change. Automated matrix captures
blocked external traffic and exercised the unavailable-tile state.

OSM attribution/ODbL remains visible. Tile images are allowed by CSP only on the
map document; the page and images send an origin-level referrer. No provider
key, geocoder, address mutation or public polling was added. The owner authorized
Leaflet as the one new runtime dependency; TypeScript definitions are dev-only.
OSM tiles have no SLA and must remain low-volume interactive use, without bulk
prefetch: [official tile policy](https://operations.osmfoundation.org/policies/tiles/).
API used: [Leaflet reference](https://leafletjs.com/reference).

## Verification

- Relevant suite: **96 passed, 0 failed, 0 skipped**, including PostgreSQL
  food-cost/SKU/return and inventory scope cases.
- Native PostgreSQL tests use a separate UTF-8 database. An initial C-locale
  Cyrillic case comparison failed; rerunning unchanged resolver code under the
  appropriate UTF-8 locale passed. No resolver change was made to hide it.
- TypeScript: PASS. ESLint: PASS. `git diff --check`: PASS.
- Production build: PASS (Next.js 16.3.8, compiled and typechecked).
- No Docker, production DB/env access, monetary operations, commit, push,
  merge or deploy in this iteration.
