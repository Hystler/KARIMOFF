# KARIMOFF Final RC Stabilization

Date: 2026-10-03, Europe/Moscow. Scope: local stabilization only, not a new general audit.
Base RC: `635fb4d`; branch: `release/karimoff-2026-10`.
Application fixes were verified together, not on the separate frontend branch.
Resolve the final documentation commit with `git rev-parse release/karimoff-2026-10`.

## 1. Revision and production boundary

Remote main was checked: `3a366cab71f6ffe39796567e83fd8eaca3bbe591`.
Local main is still `d322914`; it was not advanced. RC contains origin/main as an ancestor.
Timeweb application 229491 / karimoff-production: auto-deploy is **false**.
Platform last commit and latest successful deployment identify `e478731`, not `3a366ca`.
The latest successful platform deployment was 2026-10-03 06:35:41-06:38:18 UTC.
This work did not initiate it. This is platform evidence, not an in-container revision measurement.
No production writes, provider operations, physical device commands, push or main merge were performed.

## 2. New logical commits

| Commit | Task |
| --- | --- |
| 7ed31d8 | Separate DDL credentials; restricted runtime grants; fresh/upgrade/restore harness |
| bc8b7e8 | POS same-key serialization, UNKNOWN queue safety, physical-payment enablement gate |
| 8f536c6 | Closed polygon fix, exact unique geocode, regional hierarchy, delivery enablement gate |
| aa77e87 | Apple Wallet opt-in and lazy signing dependency |
| cde9a06 | Do not classify unknown imported fulfillment as pickup |
| 3670b90 | Router-based checkout navigation; remove lint warning |
| 05345ab | Document migration credentials and OFF-by-default flags |
| 97691ee | Isolated responsive customer/staff browser harness |
| 2f0f3f5 | Required modifier interaction and customization persistence in the browser |
| af57d4a | Final report, safe evidence and controlled rollout instructions |

The final report/evidence commit is HEAD when this document is committed;
all new commits are listed by `git log 635fb4d..HEAD --oneline`.
The original five POS commits were not cherry-picked again.

## 3. Migration role implementation

Confirmed failure mechanism: startup used `MIGRATION_DATABASE_URL || DATABASE_URL`.
With no separate migration DSN, `karimoff_app` attempted DDL without CREATE on public.

Runner now uses only MIGRATION_DATABASE_URL for writes. Production missing that URL
fails before connection with a clear error; it never silently tries runtime credentials.
Read-only startup uses DATABASE_URL and verifies schema postconditions without DDL.
The existing data runner skips catalog/recipe writes in read-only mode.

New additive migration: `20261003070000_runtime_role_permissions.sql`.
It grants explicit application-table DML, linked sequence USAGE/SELECT, analytics-view
SELECT and required function EXECUTE. RLS policies authorize the server runtime role;
customer/staff authentication and point scope remain application-service responsibilities.
No browser/public role receives these server privileges.
Runtime does not own public or application relations and cannot inherit CREATE.
Migration aborts if runtime has superuser/CREATEDB/CREATEROLE/BYPASSRLS privileges.
Future tables must explicitly add approved runtime grants; no global ALL privilege workaround.

Local migration role: karimoff_migrator, NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS,
owns the isolated application schema/objects. Administrator is used only to provision scratch roles/DBs.
Runtime: karimoff_app, no owner/migration membership, no schema/database CREATE.
Production object ownership was not altered or proven identical to the synthetic schema.
Production DDL role must own existing affected objects or inherit the narrowly scoped schema-owner role;
CREATE alone is insufficient for ALTER, indexes, constraints and grants on existing objects.

Previously present main migration bytes were restored exactly, rather than retroactively
changing potentially applied migration history. All 25 main file checksums match.

## 4-6. Fresh, upgrade and negative permissions

PostgreSQL 17, local Docker, loopback 55443, unique scratch databases, no production DSN.
Fresh scratch databases start empty, then the harness provisions legacy compatibility roles
and auth.uid/auth.role/auth.jwt SQL functions before the historical migrations, plus synthetic
catalog data after baseline. These are explicit local bootstrap fixtures, not real Supabase auth
or a claim that unbootstrapped vanilla PostgreSQL can execute historical policies unchanged.
The RC application uses its server sessions, not these fixture JWT functions. Production upgrade
must verify its actual existing legacy dependencies; this task did not replace production auth.

| Check | Result |
| --- | --- |
| Fresh, all chronological migrations | 28 applied by migration role |
| Upgrade from main-equivalent synthetic schema | 25 historical + 3 additions |
| Upgrade through actual application runner | PASS; unusable runtime URL supplied to prove no fallback |
| Runtime schema read-only verification | PASS, fresh and upgrade |
| Objects | 76 public tables, 284 indexes, 365 constraints, 1 sequence |
| Runtime product read, customer/order/payment/receipt/application writes | PASS |
| Runtime CREATE TABLE, ALTER products, DROP products, CREATE SCHEMA | All rejected, SQLSTATE 42501 |
| Runtime ownership | Zero public relations owned; schema/database CREATE false |
| Docker RC health and catalog with features OFF | HTTP 200 on fresh and upgraded DBs |

There is no Prisma dependency in this project: application SQL connectivity was tested directly.
The upgrade is not a restored production dataset or proof of every possible live schema drift.
Production ownership/schema preflight remains a required authorized deployment step.

## 7. PostgreSQL test suite

Full run: **404 passed, 0 failed, 0 skipped**.
The former 33 opt-in PostgreSQL cases ran, not just their non-DB counterparts.
Provider/KDS/inventory suites used previously isolated local fixtures on 55441/55442.
New actual runtime-role tests used the freshly migrated 55443 database.
These tests cover real SQL transactions but mocked provider/device results.

## 8. POS software fault injection

Passed: concurrent same-key double click; two tablets/different keys competing for one device;
busy device; safe pre-charge decline/cancel; unsafe failure becoming UNKNOWN; timeout;
lost response followed by late paid callback; duplicate callback; stale unknown after paid;
new service instance after dispatch (backend/bridge-reconnect simulation); expired queued job;
fiscal evidence missing after paid result; manual resolve with required receipt reference;
reconciliation by late callback/manual resolve; disabled flag while accepting in-flight callbacks.

Fixes: transaction advisory lock before idempotency lookup; queued timeout persists UNKNOWN
instead of leaving a command eligible for dispatch; explicit EVOTOR_POS_PAYMENTS_ENABLED gate.
UNKNOWN remains terminal-busy and is never automatically turned into a new charge.
Dispatch is not success; paid callback without receiptReference remains UNKNOWN / outside KDS.
After confirmed payment/fiscal callback: one business order, one intent, one payment,
one KDS payment event and one canonical order sale. Repeated ready deducts recipe once:
synthetic stock 100 -> 90, one deduction record. Fiscal/courier events do not deduct stock.

Limits: restarting a loaded service is a software simulation, not killing the real APK during
bank communication. There is no proven automatic bank/acquirer reconciliation endpoint here.
An authenticated receiptReference is a software gate, not independent proof that physical
fiscal registration succeeded. That contract must be accepted on hardware before enabling POS.

## 9. Delivery software

Master environment flag DELIVERY_ENABLED is explicit opt-in and combines with store settings.
It stays OFF for the first production rollout.
Store-scoped configuration: 3000 m straight-line Haversine, fee 200, free >=2500 after
merchandise discounts, no minimum, online YooKassa only, 60-minute promise, Europe/Moscow
11:00-20:30. Apartment remains optional.

Passed: 2999/3000/3001 m; distant address; polygon interior and outer boundary exclusion;
malformed/imprecise/ambiguous geocode; network failure; valid regional hierarchy;
frontend coordinates ignored; server fee forged as 999 corrected to 200/0; free delivery
has no zero-value receipt item; threshold 1/200/2499/2500/2501; discounted threshold tests;
immutable address snapshot; pending payment outside KDS; duplicate paid event yields one KDS event.

Closed GeoJSON ring bug fixed: a zero-length first/last segment formerly matched arbitrary
points as boundary points. It now matches only the actual identical vertex.
Outer exclusion boundary is excluded. Any future polygon holes need separate map acceptance.

Time: 10:59 NO, 11:00 YES, 20:30 YES, 20:31 NO. Existing implementation is minute-based;
20:30:00-20:30:59 is accepted. Order creation checks time server-side in
src/app/actions/orders.ts; webhook confirmation never checks the delivery cutoff again.
An order created during allowed hours can be paid at 20:31 and proceed to KDS.
Merely opening checkout before cutoff does not reserve eligibility if order creation is later.
This existing rule was retained, not replaced with an invented reservation rule.

## 10. Yandex blockers

Candidate center is GeoJSON [longitude, latitude]: **[38.0557080, 55.9092210]**.
It is NOT confirmed by a real Yandex API/key smoke.
Current exclusion is the OSM aerodrome polygon (relation 3300255), not a Yandex-confirmed boundary.
Center, all polygon edges and disputed access areas still require visual Yandex comparison/overlay.
No production keys are present under YANDEX_GEOCODER_API_KEY/YANDEX_SUGGEST_API_KEY.

Required products: HTTP Geocoder (JavaScript API and HTTP Geocoder product), and separate
GeoSuggest API if suggestions are enabled. Both current keys are server-only.
Restrict to stable server **outbound** IPs, not the application ingress/public-domain IP.
If Maps JS is later embedded, use a separate browser key restricted by domains; do not expose these keys.
Check commercial/extended licensing for storing coordinates/address snapshots before activation.
No API resource, key, contract or paid infrastructure was created.

Official references: [HTTP Geocoder request](https://yandex.ru/maps-api/docs/geocoder-api/request.html),
[key restrictions](https://yandex.ru/maps-api/docs/js-api/limit.html),
[API terms](https://yandex.ru/legal/maps_api/ru).

## 11. YooKassa software

Existing mocked/SQL tests passed for server prices, provider re-fetch, amount/currency/order
validation, stable idempotence keys, duplicate/delayed/out-of-order events, reconciliation,
return URL not proving payment and bounded monetary-operation retry windows.
Unknown creation result after the guaranteed idempotency window must stop for investigation,
not retry a new monetary request/key. Existing expired-window tests passed.
No real provider operation was performed and masked production env does not prove live/test mode.

First receipt uses full_prepayment. Pickup closing receipt follows handed_out.
Delivery closing receipt follows delivered only; courier_in_transit creates none.
Duplicate final transition creates one settlement receipt. Paid delivery is a separate service
item in the same payment/receipt snapshots; free delivery omits the item.
Two receipts do not create a second payment, sale or inventory deduction.
Real provider acceptance of both receipts and actual shop fiscal settings is still required.

## 12. Public pickup display

Existing RC explicit fulfillmentType=pickup filter retained and regression passed:
pickup ready YES; delivery ready, courier_in_transit and delivered NO.
Public payload is explicitly projected; tests assert no customer name/phone/address/comment/total.
Local public display route rendered at all six sizes. No production display order was created.

## 13. Frontend regression

126 checks: 390x844, 430x932, 768x1024, 1024x768, 1440x900, 1920x1080.
Chromium/Chrome emulation, NOT real iPhone/Safari or the physical terminal browser.
Home/catalog, product pages, sticky add, cart/cookie/focus/Escape, login/register, pickup
checkout, mocked delivery address + paid/free fee UI, profile/history/loyalty, payment-return
empty state, 404, admin/orders/analytics/sales/economics, POS, KDS and public display were rendered.
Anonymous admin redirects to staff login; permitted synthetic sessions render closed sections.
Required modifier selection and cart persistence are verified by the browser harness.
No horizontal overflow or pageerror in recorded checks. Main/Desktop four columns, existing hero,
Telegram blue, MAX purple, footer and density separation remain unchanged.
Master logo is still not approved; current clean component is temporary.
Real Telegram/MAX consent, real payment completion, Safari and actual equipment are NOT VERIFIED.
This is not proof of every possible empty/loading/error state or offline/sleep recovery on hardware.

## 14. Analytics and inventory

Synthetic DB tests: confirmed explicit Evotor reconciliation link = one canonical sale/payment;
unlinked operations remain separate, not guessed by amount/time/name. Two receipts never add revenue.
Duplicate webhook/callback/status does not duplicate business sales or recipe deduction.
Modifiers/shortage and station-ready semantics run in the existing PostgreSQL tests.
New filter test: all = pickup + delivery + unknown; unknown legacy receipt is not automatically pickup.
Revenue follows existing canonical analytics_included/completed business rules, not fiscal-event count.
Fee is included once in one order; delivery fee lines are not additional sales.

Remaining POS activation limitation: automatic durable bridge receiptReference -> imported Evotor
document linkage is NOT established merely by these tests. Without a confirmed link, both rows
remain visible and may both count. Physical acceptance must prove linkage or add an exact-ID
linking fix before POS activation; never hide similar-value operations heuristically.
Existing provider label `evotor` means the integration path, not an identified bank acquirer.
Actual acquiring-provider dimension is unknown until device/provider metadata is established.
This limitation is not a reason to rewrite working offline accounting during this stabilization.

## 15. Dependency advisory decision

npm audit --omit=dev: 2 high, 0 critical. The two entries are node-forge and its dependent
passkit-generator, not evidence of two independently exploitable application paths.
Installed node-forge 1.4.0 via passkit-generator 3.6.1.
GHSA-86w9-cpqp-85rv affects <=1.4.0 RSA PKCS#1 v1.5 signature verification;
audit reports fixAvailable=false. No forced update or new production dependency was installed.
Passkit signs outgoing passes using server-provided cert/key PEM; reviewed flow does not accept
attacker PEM/signatures for this RSA verification path. This is reachability analysis, not immunity.
Wallet now requires explicit APPLE_WALLET_ENABLED=true and lazily loads signing code after the gate.
First rollout keeps it false. Dependency advisory remains open and must be rechecked before Wallet activation.
[Primary advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).

## 16. Backup / restore

Local synthetic pg_dump -Fc -> NEW isolated PostgreSQL 17 DB -> pg_restore -> RC runtime PASS.
Dump 633957 bytes; restore 1193 ms. Row counts and full row-content hashes matched for products,
orders, payments, receipts, customers and inventory; 28 migration records preserved.
40 products, 1 synthetic order/payment/receipt/customer/inventory item; Docker runtime/browser starts
under the restricted role on the restored schema.
1.193 s is this tiny fixture restore time, NOT a production RTO estimate.
Timeweb backup was not downloaded/restored; production-sized restoration and its RTO remain unverified.
Read-only Timeweb policy: enabled daily, retention 1 copy. Latest visible completed copy:
2026-09-29 19:30:41 UTC. On October 3 this is over three days old, not demonstrated 24-hour RPO.
Verify/create a fresh backup under separate authorization before production DDL/deploy.

## 17. Final checks

lint: 0 errors / 0 warnings. Typecheck: PASS. Tests: 404/404, 0 failed / 0 skipped.
Host Next build: PASS. Docker build: PASS. Docker runtime health/catalog: PASS on fresh/upgrade.
Browser: 126 checks, no recorded overflow/pageerrors. npm audit: unresolved 2 high, mitigated Wallet OFF.
git diff --check: PASS. Generated outputs/ ignored, not deleted or committed wholesale.
Reports contain no production secrets or customer data; selected screenshots use isolated synthetic fixtures.
Owned app containers were stopped. Other Docker containers and Colima are left running for other work.

## 18-21. Deployment preparation and decisions

See controlled-production-release.md for exact env scope, role preflight, migration command,
manual Timeweb steps, rollout/rollback order and hardware/provider acceptance.
See final-rc-test-matrix.md for separate code/unit/DB/browser/provider/hardware/production levels.

SOFTWARE RC READY FOR MAIN: **YES**, with delivery, physical POS payments and Apple Wallet OFF.
READY FOR CONTROLLED PRODUCTION DEPLOY WITH DELIVERY OFF AND POS PAYMENTS OFF: **NO NOW**.
Concrete remaining operational blockers: fresh production backup not evidenced; production migration
credentials/ownership and runtime read-only startup configuration not yet provisioned/validated.
No further general audit or permanent hosted stage is needed to resolve those.
READY TO ENABLE DELIVERY: **NO**: real Yandex key smoke, center/polygon validation and real YooKassa
two-receipt acceptance remain outstanding.
READY TO ENABLE PHYSICAL POS: **NO**: physical payment/fiscal/unknown-state acceptance, exact receipt
import linkage and actual acquiring metadata remain outstanding.

Dirty POS worktree still contains 33 modified tracked files plus staff/auth, analytics, UI,
delivery and generated untracked changes. None were copied wholesale, reset or cleaned.
The existing external safety snapshot remains intact. main was not changed; no push was performed.
