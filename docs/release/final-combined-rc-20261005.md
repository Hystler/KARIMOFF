# Final combined delivery / POS candidate - 2026-10-05

## Scope and release identity

This is the bounded final integration, not a new general production audit.
No production deploy, main merge/push, production DB/env change, live provider operation,
APK installation or physical cashbox operation was performed.

- Branch: `codex/final-combined-rc`.
- Worktree: `/Users/akimkovalenko/.codex/worktrees/karimoff-final-rc/KARIMOFF`.
- Verified base: `97258c505dff92087212933e9815cae1d19853f0`.
- Verified POS source: `79e96edb8803d4874d3bdf654f5121db68a934ab`.
- Verified origin/main: `3a366cab71f6ffe39796567e83fd8eaca3bbe591`.
- Final SHA: resolve this branch's HEAD after this report commit; the exact value is also
  recorded in ignored `outputs/final-combined-20261005/git-proof.json` and the coordinator reply.

Neither local main nor the obsolete/nonexistent f95ba8c/PR #2 was used as an integration base.
Executor delivery/POS worktrees and the dirty legacy POS checkout were not edited.
The five older POS foundation commits were already in the base and were not copied again.

| POS source commit | Integrated commit | Content |
| --- | --- | --- |
| 40fef1c | 4c81ff3 | Fiscal identity, receipt UUID, explicit terminal, KDS gate |
| c1de070 | f08c064 | Bridge/cloud device and store binding |
| 83ebf5d | 860d1b9 | All print groups, exact receipt reconciliation, migration registration |
| 616f03d | 95fb64c | Synthetic print-group variants |
| 79e96ed | ac0e260 | Real-shape synthetic fixture and actual importer regression |

Each cherry-pick records its source with `-x`. Additional bounded commits:
`9b9068a` (local diagnostic image selection, delivery-base upgrade proof, Android build exclusions),
`f017c9e` (two distinct tablet requests racing for one terminal), and the final report/checklist commit.
No application dependency or lockfile changes were needed.

## Conflict decisions

Four distinct files needed manual conflict resolution; no blind ours/theirs selection:

| File | Decision |
| --- | --- |
| `src/lib/integrations/evotor/pos-payments.ts` | Combine local UUID, fiscal fields, cloud device/store and result metadata with the release's `delivered_at` guard. Manual cancellation cannot unlock a dispatched UNKNOWN, even if older result metadata suggests otherwise. |
| `src/app/api/pos/payments/[id]/resolve/route.ts` | Keep required imported document plus FN/FD/FP; error also explicitly warns against repeating payment. |
| `tests/rc-pos-faults.test.mjs` | Preserve dispatched UNKNOWN cancellation assertion, add fiscal identity callbacks and retain the delivery RC's fixed local port guard. |
| `scripts/apply-runtime-schema-migrations.mjs` | Register POS fiscal migration before whitelist migrations, preserving both combined delivery RPC corrections and no runtime DDL fallback. |

The remaining POS changes applied cleanly. Delivery checkout/auth, frontend layout, courier statuses,
YooKassa closing-receipt behavior, public pickup filter and existing analytics/inventory rules remain.

## Migration order and permissions

There are 32 chronological SQL migrations in the candidate. The seven beyond origin/main are:

1. `20260929150000_add_delivery_checkout_and_courier_status.sql`
2. `20260930120000_delivery_release_hardening.sql`
3. `20261003070000_runtime_role_permissions.sql`
4. `20261003120000_pos_fiscal_identity.sql`
5. `20261003180000_delivery_address_whitelist.sql`
6. `20261004120000_delivery_whitelist_release_integration.sql`
7. `20261004133000_whitelist_pickup_rpc_initialization.sql`

POS does not replace order RPCs. Its new fields/indexes and fiscal-groups table coexist with whitelist
and the newer combined delivery functions. Both sets are registered in the actual migration runner.
Previously committed base SQL bytes were unchanged.

PostgreSQL 17 proofs, with no production data or credentials:

- Fresh installation: all 32 migrations under non-superuser migrator PASS.
- Upgrade from origin/main's 25 migrations through the actual runtime runner: PASS.
- Upgrade from delivery base 97258c's 31 migrations: PASS; only the POS fiscal migration is added.
- Runtime `karimoff_app`: DML/application queries PASS; no owned public objects, superuser,
  BYPASSRLS, database CREATE or public-schema CREATE. CREATE/ALTER/DROP each denied.
- Runtime read-only startup verifies all migration postconditions, including POS and whitelist.
- Actual migration runner ignores the deliberately unusable runtime URL for DDL.
- Synthetic pg_dump/pg_restore: products/orders/payments/receipts/users/inventory content and all
  32 migration records match. Approximately 1.04 s (main scenario) / 0.97 s (delivery-base scenario).
  This is not a Timeweb production restore, production RPO or production-sized RTO proof.

Docker includes all four POS/whitelist SQL files, runs as UID 1001, and contains no baked DB URLs.
POS SQL SHA-256: `9711f644c0a461d368327198c139f50ea8725e77bb485115b6ca129f2bd3d680`.
Historical whitelist SHA-256 remains `f0d2ab4a0e0e7d9cbbea5d32a7d2ccb4b50df3d06325a7f80f57045e79b7eb42`.

## Combined verification

Final suite: **428 passed, 0 failed, 0 skipped, 0 cancelled**. The explicit test DSNs refer only to
the recognized loopback PostgreSQL 17 container and synthetic databases. No .env was loaded.
The opt-in YooKassa, kitchen, food-cost and whitelist PostgreSQL suites all ran.

| Scenario | Evidence / result |
| --- | --- |
| Web pickup | Named real PostgreSQL adapter, idempotent order/payment, verified software payment state, KDS gating, kitchen/handout and closing-receipt regressions PASS. |
| Web delivery | PostgreSQL whitelist ID and immutable DB address snapshot; fee 200 below 2500, zero at/above 2500; duplicate paid event gives one KDS event; courier handoff creates no closing receipt; delivered creates exactly one; two receipts give one canonical revenue row. |
| POS payment | Explicit mapped device/store, local receipt UUID before acquisition, payment plus complete fiscal identity required for KDS. `fiscal_pending` records acquired payment but does not release KDS or permit a second charge. |
| POS concurrency / faults | Same-key double request and distinct-key two-tablet race PASS; one order/intent, busy second tablet, no unpaid KDS/inventory/revenue. Timeout/restart/UNKNOWN/decline/cancel/late and duplicate result recovery PASS. A pending journal row is not recognized revenue. |
| POS cloud import | Actual importer with synthetic fixture derived from read-only real SELL shape; bridge-before-import and import-before-bridge both link one sale by exact device/store/FN/FD/FP. Reimport/callbacks preserve KDS/inventory/sale counts. |
| Fiscal ambiguity | All print groups preserved; incomplete, ambiguous, wrong device/store/fiscal identity do not silently link by price/time. Manual paid resolution requires exact imported identity. |
| Inventory | One canonical ready-trigger deduction; repeated readiness, callbacks, imported receipts and delivery/fiscal transitions do not deduct again. |
| Public pickup display | Explicit fulfillment=pickup; delivery ready/in-transit/delivered excluded. Public serialization omits address, phone and courier comment. |

Lint PASS (no errors/warnings), typecheck PASS, Next.js production build PASS,
Docker build/runtime PASS and Android `lintDebug assembleDebug` PASS.
Android emitted the existing SDK XML/deprecated API tooling warnings, not build failures.
Gradle's unused Android-test build task is SKIPPED; there is no instrumented hardware-test claim.

Docker image: `karimoff-final-combined-rc:20261005`,
ID `sha256:7555f797780cbf1e160b0e27e55de26876cd67a9cacd7e53fd0f947e709fc2be`.
Runtime mounts the fail-closed external-fetch preloader, uses restricted runtime DB role and synthetic
payment/session credentials; Evotor sync/bridge/physical payments and client notifications disabled.
The local YooKassa scheduler can access only synthetic DB records; external provider fetch is blocked.

Browser regression on this image: 154 checks, no JS errors or horizontal overflow at
390x844, 430x932, 768x1024, 1024x768, 1440x900 and 1920x1080.
Includes customer cart/whitelist delivery/free threshold, profile, sticky purchase/footer,
staff orders/analytics/economics/POS/KDS and the new Evotor POS identity/reconciliation pages.
POS identity page empty state is browser-checked; populated fiscal/import behavior is DB-tested.
No checkout/payment form was submitted, real Telegram/MAX consent imitated, or hardware invoked.
This is Chromium emulation, not a Safari/iPhone acceptance result.
An initial added browser check had a wrong reconciliation route; the helper was corrected and the full
browser run repeated successfully. No application route change was needed.

| Area | Code | Unit / software | DB integration | Browser | Hosted stage | Real provider | Real hardware | Production |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pickup / YooKassa | included | PASS | PASS | PASS, no charge | not run | pending acceptance | N/A | not deployed |
| Delivery / whitelist | included | PASS | PASS | PASS | not run | pending YooKassa | N/A | OFF / not deployed |
| POS fiscal identity | included | PASS | PASS | PASS, no payment | not run | read-only SELL shape only | pending | OFF / not deployed |
| KDS / display / inventory / analytics | included | PASS | PASS | PASS | not run | pending E2E | pending POS E2E | not deployed |

## Android artifact

KARIMOFF Terminal Bridge: **versionName 0.21 / versionCode 21**, package `ru.karimoff.evotor.bridge`.
Debug APK copied outside Git for later explicitly approved hardware acceptance:

`/Users/akimkovalenko/.codex/handoffs/KARIMOFF/artifacts/karimoff-terminal-bridge-0.21-code21-1e16266b.apk`

SHA-256: `1e16266b97ae0a565da2d4a3935ece299347e78b0d8024b54f35549d61ef25e8`.
No APK was installed or app version/settings changed in Evotor. Approved installation/signing path
must be checked on the point; a debug artifact is not an Evotor Market publication.
See `docs/release/pos-physical-acceptance.md` for success, decline/cancel and network/UNKNOWN scenarios.
The real SELL handoff remains outside Git and is not redistributed in the release artifacts.

## Manual production preflight - prepare only

Owner authorization is required for each external change. No paid stage/resource is needed.

1. Keep production auto-deploy OFF; verify it before any eventual main push.
2. Obtain a fresh completed Timeweb backup, its timestamp/ID and restore access. Confirm capacity
   and restore procedure; do not treat the local synthetic restore as production backup verification.
3. Read-only inspect actual DB role/schema/table/sequence ownership, memberships and pending migration
   postconditions. A migration LOGIN may use a scoped application owner membership/ownership;
   schema CREATE alone does not grant ALTER of tables owned by another role. Do not broadly grant
   superuser/CREATE/OWNER to runtime or reassign managed-cluster objects/extensions.
4. Securely supply `MIGRATION_DATABASE_URL` only to the approved one-shot DDL command. Use an
   existing authorized DDL owner or provision the scoped role after ownership inspection. The tested
   `20261003070000_runtime_role_permissions.sql` and POS/whitelist SQL provide scoped runtime DML,
   sequence/RPC access and RLS policies. Recheck runtime has no inherited DDL privileges.
5. Preserve runtime `DATABASE_URL=karimoff_app`, auth/encryption keys, S3, existing offline Evotor
   import settings and YooKassa callbacks. Set `RUNTIME_MIGRATIONS_READ_ONLY=true` for runtime.
   Never copy mock secrets, local DSNs or diagnostic NODE_OPTIONS into Timeweb.
6. Explicit initial gates: `DELIVERY_ENABLED=false`, `EVOTOR_POS_PAYMENTS_ENABLED=false`,
   `APPLE_WALLET_ENABLED=false`. Delivery site/location coverage is not activated or seeded here.
7. Only after permission: integrate this branch into main once, record the resulting exact main SHA
   (merge SHA may differ from candidate SHA), push main with auto-deploy still OFF.
8. From approved exact source/image, run the controlled one-shot schema migration with DDL credentials,
   verify postconditions/permissions, then manual-deploy that exact approved SHA. Migrations must
   finish before read-only application startup, not be deferred until after a failed startup.
9. Read-only health/catalog/public/staff/DB smoke; check all three gates OFF and existing offline
   imports still function. Do not create test production orders or change real sales/stock/statuses.
10. Observe startup/permission errors, existing import freshness, payment/fiscal reconciliation backlog,
    outbox age, health and UI errors. Real YooKassa, physical POS and delivery activation require later,
    separate permissions and acceptance.

Rollback is application-only to an explicitly verified known-good revision. Keep the new schema,
integration/session/encryption keys and OFF flags; never restore an older production DB automatically.
Smoke the rollback application against an approved safe copy of the upgraded schema first. The old
production fallback has not been revalidated in this bounded integration; inspect the actually deployed
revision at the future preflight. Do not use failed main startup as a known-good fallback.
If monetary state is uncertain, stop new affected operations and reconcile; no new charge to recover a timeout.

## Remaining manual gates and decisions

- Production preflight: fresh backup, actual DDL ownership/credential, runtime env and exact target SHA.
- POS: approved Bridge installation/cloud binding, real device/acquirer, one small authorized payment,
  actual FN/FD/FP, KDS/inventory/analytics 1x and cloud automatic reconciliation; decline/cancel and UNKNOWN recovery.
- YooKassa: actual authorized payment and two registered receipts with the store's configured fiscal values.
- Delivery activation: owner validates store point and disputed A1-A8 / H1-H12 aerodrome sections;
  frozen 1233-address manifest applied only with permission, 216 manual-review addresses remain disabled.
  No Yandex/GeoSuggest/DaData runtime dependency; manual review is not a software integration blocker.
- Courier app, assignment, live tracking and bot notifications are not required for this release.

FINAL SOFTWARE RC READY: YES.
READY FOR CONTROLLED PRODUCTION DEPLOY WITH DELIVERY/POS OFF: YES, after the mandatory manual preflight and permission.
READY FOR POS HARDWARE ACCEPTANCE AFTER DEPLOY: YES (software/artifact/checklist); hardware itself is NOT VERIFIED.
No delivery or physical POS activation is authorized by these decisions.

## Local evidence

Generated evidence is ignored, not committed, and contains only synthetic test data:

- `outputs/final-combined-20261005/tests.tap`, `pos-concurrency.log`, lint/typecheck/build logs.
- `outputs/final-combined-20261005/database-from-main.json`, `database-from-delivery.json`.
- `outputs/final-combined-20261005/docker-build.log`, `browser-smoke.log`, `git-proof.json`.
- `outputs/release-20261003/database/ready.json` and restored local dump.
- `outputs/release-20261003/browser/results.json`, screenshots and runtime log (current run).

The inherited evidence-directory dates are not evidence timestamps; JSON records identify this run.
Only owned browser app containers/processes were stopped; shared PostgreSQL/Colima were not stopped or pruned.
