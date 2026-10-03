# Final RC Revalidation - 2026-10-03

This is a targeted stabilization follow-up, not another general production audit.
Branch: `release/karimoff-2026-10`. Verified application revision:
`32edb9be56e15a2ca8b26247083335903984ab01`.
The final report-only commit is the branch HEAD after this report is committed.
Evidence: `evidence/20261003-revalidation/`. Earlier reports/evidence are retained as history.

## 1. RC and integration base

The actual starting RC was `f789a56`, not the historical `635fb4d` or `824f0f8`.
Fresh successful fetch still resolves origin/main to
`3a366cab71f6ffe39796567e83fd8eaca3bbe591`. Local main remains `d322914`.
The previously stated PR #2 merge SHA `f95ba8c7873340b0f7ba6c0a4693a0151d5d0f18`
is not available as a commit in this checkout. This is an unresolved coordination
discrepancy, not proof that those purported PR changes are present.
No integration should proceed against an assumed f95ba8c base until the owner confirms
the repository/PR and a fresh fetch agrees. No main update, rebase, merge or push was done.

## 2. New scoped commits

| Commit | Change |
| --- | --- |
| 80ee259 | Remove synchronous footer-state reset causing lint failure; preserve footer-safe sticky purchase; make browser modifier fixtures repeatable and check return from footer |
| 32edb9b | Reject manual cancellation of an already dispatched UNKNOWN POS payment; retain its lock against another charge; SQL regression and clear staff error |
| Final report-only HEAD | This follow-up report, matrix and selected sanitized local evidence |

Existing role, POS, delivery and Wallet stabilization is already in the RC and was not
re-applied. The original five POS commits are present once. The later f789a56 header/footer
polish was preserved. No new production dependency or historical migration edit was made.

Separate work not integrated:

- `codex/pos-fiscal-identity`: 40fef1c and c1de070, HEAD c1de070. Real fiscal identity,
  exact imported-receipt reconciliation and cloud-device/store binding remain outside this RC.
  Its resolveUnknown implementation must retain the new 32edb9b cancellation guard on integration.
- `codex/delivery-address-whitelist-main`: 1c7bf4d, 01ad802, 5de16b7, ceb447a;
  HEAD ceb447a, based on observed origin/main 3a366ca. This alternative address-validation
  implementation needs an explicit integration/business decision and combined regression.
  This RC still uses the agreed Yandex flow; whitelist behavior is not claimed as included.
- Original POS worktree at 08e78a5: 33 modified tracked files and mixed untracked staff/auth,
  analytics, delivery, UI and generated outputs. Untouched; external safety snapshot retained.

## 3. Migration role implementation

Confirmed original cause: fallback `MIGRATION_DATABASE_URL || DATABASE_URL` used the
runtime karimoff_app identity for CREATE TABLE without CREATE on public.
The RC runner already requires MIGRATION_DATABASE_URL for writes and fails before
connecting if missing. Read-only mode verifies postconditions using runtime DATABASE_URL.
Production startup must not use runtime credentials for DDL.

Local PG17 migrator is NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS and owns the
isolated DB/schema/objects. Runtime owns none of the public relations or schema;
explicit application DML, approved EXECUTE and sequence USAGE/SELECT are granted.
Additive grants migration: `20261003070000_runtime_role_permissions.sql`.
Actual production ownership must still be provisioned/verified under separate permission.
Prefer the existing migration runner as an authorized one-shot operation, then start the
app with RUNTIME_MIGRATIONS_READ_ONLY=true and without DDL credentials in the runtime.
This does not require a paid or permanent stage or assume a native Timeweb pre-deploy job.

## 4. Fresh migration result

PASS: empty isolated PG17 DB plus documented compatibility bootstrap, 28 chronological
migrations, runtime schema verification, application health/catalog HTTP 200.
76 public tables, 284 indexes, 365 constraints, one sequence.
Legacy auth functions/roles are explicit local fixtures; this is not an unbootstrapped
vanilla-PG install or real Supabase authentication proof. No Prisma is used by this project.

## 5. Upgrade migration result

PASS: synthetic main-equivalent 25-migration schema, three additive RC migrations through
the actual runner, runtime read-only verification and health/catalog HTTP 200.
Main historical migration checksums match. An intentionally unusable runtime URL proves
DDL does not fall back to it. This is not a restored production schema/data-drift proof.

## 6. Runtime negative permissions

PASS on fresh and upgrade: product reads and required synthetic customer/order/payment/
receipt writes work. CREATE TABLE, ALTER TABLE, DROP TABLE and CREATE SCHEMA fail with
SQLSTATE 42501. Runtime schema/database CREATE, superuser, CREATEDB, CREATEROLE and
BYPASSRLS are false; public relation ownership count is zero.

## 7. PostgreSQL tests

404 tests passed, zero failed, zero skipped in the final full run. The former 33 opt-in
PostgreSQL cases ran with isolated local fixtures on loopback 55441/55442. New role-based
SQL tests ran on unique fresh PG17 DB on 55443 with karimoff_app. No production DSN was used.

## 8. POS software fault injection

PASS under mocked device results and actual SQL: same-key double click, competing tablets,
busy device, safe decline/cancel, timeout, lost response then late paid callback, duplicate
and stale callbacks, service reload/reconnect, expired queued command, paid without fiscal
reference, manual resolution, disabled flag while accepting already in-flight results.
One order/intent/payment/KDS event/canonical sale and one recipe deduction are asserted.
Dispatch does not mean paid; UNKNOWN blocks a new intent and is not automatically recharged.

New safeguard: a dispatched UNKNOWN cannot be manually cancelled to unlock another charge.
Only an undispatched command can be manually cancelled; a trusted safe device cancellation
can still resolve a dispatched command. Tests retain late paid recovery and exactly-once KDS.
Current manual paid resolution still accepts a textual receiptReference: it is NOT independent
fiscal proof. The separate exact-fiscal-identity work is required before physical POS activation.
No bank-state query or real bridge/pinpad restart was tested. These are software simulations.

## 9. Delivery software tests

PASS: 2999/3000 m included, 3001 m excluded, polygon interior and outer boundary excluded,
malformed/imprecise/ambiguous geocodes and provider failure fail closed; browser coordinates
are ignored and the server geocodes the address. Pickup does not depend on delivery validation.
2499 -> fee 200; 2500/2501 -> zero; discounted merchandise threshold and forged-fee correction
tested. No minimum; apartment optional; immutable address and fiscal/payment snapshots.

Moscow acceptance: 10:59 NO, 11:00 YES, 20:30 YES, 20:31 NO. Existing minute-based rule
includes 20:30:59. Time is checked at order creation in src/app/actions/orders.ts, not again
at payment confirmation. An order created in time can be paid after cutoff and enter KDS.
Opening checkout alone before cutoff does not reserve eligibility. This behavior was retained.
YooKassa online only, 60-minute promise, store-scoped config and master DELIVERY_ENABLED gate.

## 10. Yandex activation blockers

Candidate [longitude, latitude] = [38.0557080, 55.9092210] is not real-API confirmed.
Current aerodrome polygon is OSM-derived, not accepted against a current Yandex overlay.
No real keys are present under the expected Timeweb env names; real geocoder smoke NOT RUN.

Owner actions: request HTTP Geocoder key (JavaScript API and HTTP Geocoder product) and
separate GeoSuggest key if suggestions are used, confirm storage/license conditions,
restrict server keys to verified stable outgoing IPs, later configure server-only
YANDEX_GEOCODER_API_KEY and YANDEX_SUGGEST_API_KEY. A future browser Maps JS key must be
separate and domain-restricted. Do not buy resources automatically.
Before activation, visually accept the store center, 3-km circle and all exclusion edges
on Yandex; record disputed sections and read-only inside/outside/aerodrome address smoke.
[Geocoder](https://yandex.ru/maps-api/docs/geocoder-api/request.html),
[restrictions](https://yandex.ru/maps-api/docs/js-api/limit.html).

## 11. YooKassa software tests

PASS: server pricing, amount/currency/binding checks, provider GET after webhook, immutable
body/key, duplicate/delayed/out-of-order events, bounded reconciliation, return URL not
proving paid, and expired monetary-idempotency windows stopping for review instead of new charge.
Delivery amount includes fee once. First receipt full_prepayment; pickup closing trigger
handed_out; delivery trigger delivered only, not ready/courier_in_transit. One closing
receipt on repeated final transition; paid fee service line, free fee no zero-valued line.
Real shop mode/VAT/fiscal acceptance remain unverified, not inferred from masked credentials.
The two-receipt model is consistent with the documented provider API, not a legal certification
of this shop: [YooKassa receipts](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/payments).

## 12. Pickup display

PASS: explicit fulfillmentType=pickup predicate. Pickup ready visible; delivery ready,
courier-in-transit and delivered excluded. Public projection excludes phone, full address,
customer comment and private order data. Unit predicate/projection regression plus six-size
local display render; no real public-display order created.

## 13. Frontend regression

Final combined Docker RC: 130 checks at 390x844, 430x932, 768x1024, 1024x768, 1440x900,
1920x1080. No recorded horizontal overflow or page errors. Customer/staff pages use
synthetic authorized sessions on restored local DB, not real OAuth consent.
Home/catalog/product/modifiers, sticky purchase/cart/cookie/focus/Escape, login/register,
pickup and mocked delivery checkout with email and fee/free threshold, profile/orders,
payment-return empty state, 404, admin/orders/analytics/journal/economics, POS/KDS/display.
Sticky is visible above the footer, hidden at footer and restored after returning upward.
Preserved hero, Telegram/MAX colors, footer navigation, four desktop columns and density
separation; no hero photo or master-logo replacement. Real Safari/iPhone, OAuth and every
possible provider/network error/recovery state are NOT VERIFIED by this browser pass.
The initial rerun found duplicate synthetic modifiers in the harness; per-run product
fixtures fixed that. It was a harness failure, not a production/customer defect.

## 14. Analytics/inventory

PASS: canonical explicit-link reconciliation, two receipts not two sales, fee recognized
once in one order, duplicate callbacks/webhooks/statuses not duplicate inventory; modifiers
use existing recipe semantics. Unknown historical fulfillment remains unknown, not pickup.
Dimensions are not interchangeable: channel/fulfillment/payment method/provider/fiscal source.
Actual bank acquirer is still unknown; Evotor integration label is not bank identity.
Automatic exact POS fiscal-ID/import reconciliation is only in the separate POS branch.
Unlinked operations stay visible; guaranteed physical POS/import dedup is NOT claimed.

## 15. Security advisory

Audit: two high, zero critical, node-forge 1.4.0 via passkit-generator 3.6.1; no available
fix reported. Primary advisory still lists no patched version. Reviewed application signs
outgoing passes using server-held PEM; attacker-supplied PEM/signature verification entry
was not found. This is reachability analysis, not proof of immunity.
Existing explicit Wallet OFF gate and lazy import retained. Keep APPLE_WALLET_ENABLED=false;
reassess before activation. No force update or payment-flow change.
[Primary advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).

## 16. Backup/restore

PASS: local synthetic pg_dump -Fc (633912 bytes) -> NEW isolated PG17 DB -> pg_restore
in 895 ms -> matching row counts/content hashes -> final Docker/browser runtime.
Products 40; order/payment/receipt/customer/inventory fixture one each; migration records 28.
This 0.895-second tiny restore is NOT production RTO or Timeweb-format restore evidence.
Read-only Timeweb backup policy: daily, one retained auto copy. Latest visible completed
copy is 2026-09-29 19:30:41 UTC. Fresh pre-release backup and actual restore/RPO assurance
remain deployment blockers. No production backup was downloaded/restored or created.

## 17. Final checks and cleanup

Lint zero errors/warnings; typecheck PASS; 404 passed/zero failed/zero skipped; host and
Docker builds PASS. Final fresh/upgrade runtime health/catalog HTTP 200, anonymous admin
redirects; runtime has no migration credentials, paid features OFF. Browser 130 checks PASS.
Generated outputs remain ignored and preserved; only selected sanitized evidence is tracked.
All application containers created here were stopped. Pre-existing PG containers and
Colima/other project infrastructure are left untouched. No application test server remains for this task.

## 18. Required future production environment

See [full env table](controlled-production-release.md#required-env-plan) for purpose,
required/optional scope and secret classification. Current read-only API shows no separate
MIGRATION_DATABASE_URL or explicit new rollout flags/read-only startup setting.
Prepare DDL secret for the one-shot operation; verify DATABASE_URL is restricted runtime.
Set RUNTIME_MIGRATIONS_READ_ONLY=true and explicit DELIVERY_ENABLED=false,
EVOTOR_POS_PAYMENTS_ENABLED=false, APPLE_WALLET_ENABLED=false when authorized.
Preserve existing auth/session/encryption/S3/Evotor import and payment config; no synthetic
credentials or test network preloader in production. Yandex keys are later activation secrets.

## 19. Future manual Timeweb actions

Auto-deploy currently false; keep it OFF. Platform last commit remains e478731 (API metadata,
not an in-container measurement). Production has real offline sales and is not a test system.
After separate approval: resolve main revision discrepancy; verify fresh backup; provision
DDL ownership/secret and runtime/read-only/OFF flags; approve merge/push exact main SHA;
run controlled one-shot additive migrations BEFORE read-only RC startup; manual exact-SHA
deploy; health, catalog, staff and read-only DB smoke; observe permission/outbox/import/fiscal
errors. Never enable delivery/physical POS/Wallet incidentally.
Rollback is application-only with compatible schema/keys, not automatic old DB restore.
Old app against the actual migrated production schema still needs controlled rollback smoke.

## 20. Hardware checks still required

After separate authorization: identify actual bank pinpad/acquirer separately from Evotor
fiscal KKT; check installed bridge version and selected cloud device/store pairing; tablet
order -> correct device/sum/items -> paid -> completed fiscal operation -> durable IDs ->
one KDS entry -> one inventory deduction -> one canonical sale including exact receipt import.
Check decline, cancel and network interruption. UNKNOWN requires confirmed reconciliation
before another charge; no actual physical operation was performed here.

## 21. Real provider checks still required

Real YooKassa shop and two-receipt acceptance including paid delivery fee, real Yandex
read-only geocodes/zone overlay, real acquiring recovery and real Telegram/MAX consent.
Each requires its own permission/configuration; no real order/payment/refund/receipt now.

## Decisions

- SOFTWARE RC READY FOR MAIN: **YES for the observed 3a366ca base with delivery, physical
  POS payments and Wallet OFF**. The previously asserted f95ba8c base must be reconciled
  before any actual merge; no claim about compatibility with unavailable PR #2 changes.
- READY FOR CONTROLLED PRODUCTION DEPLOY WITH DELIVERY OFF AND POS PAYMENTS OFF: **NO**.
  Concrete blockers: fresh backup/restore assurance; production DDL ownership/credentials
  and read-only runtime setup; expected main/repository revision discrepancy before integration.
- READY TO ENABLE DELIVERY: **NO**. Real Yandex key/license smoke and center/polygon acceptance,
  plus real YooKassa two-receipt acceptance. Whitelist alternative is not yet integrated/approved.
- READY TO ENABLE PHYSICAL POS: **NO**. Exact fiscal-identity/device/import integration,
  provider reconciliation and hardware acceptance; preserve the new UNKNOWN cancellation guard.

Nothing was merged into main, pushed or deployed. No production DB/env/settings changes,
real provider operations, physical device commands or paid resources were performed.
