# Delivery whitelist integration - 2026-10-04

This is a bounded integration report, not a new project-wide audit or production authorization.
All databases/orders/customers used for tests were isolated local fixtures. No production DDL,
env changes, deploy, main merge/push, payment, fiscal operation, terminal command or sync job ran.

## Git truth

- Remote: `https://github.com/Hystler/KARIMOFF.git`.
- Fetched main: `3a366cab71f6ffe39796567e83fd8eaca3bbe591`.
- Base release: `dd72fa3db66c5153178b2297d45be5fc87ce437f`.
- Whitelist source: `819a3d231e23c1c8fb72f6fe5a03b5e4f7ab11ab`.
- Integration branch: `codex/delivery-rc-integration`, in its own managed worktree.
- Merge: `96190a5f7135fb25e23325d4d2291bdb5f4e7217`, with base release and whitelist source as parents.
- Pickup fix: `dce4ba00cc2e4feee5dc82d75273a2a2f540b3fa`.
- Final verification/documentation commit is the branch tip. Its exact SHA is recorded after commit
  in ignored `outputs/integration-20261004/git-proof.json` and in the coordinator's final response.
- All five whitelist commits are ancestors: `1c7bf4d`, `01ad802`, `5de16b7`, `ceb447a`, `819a3d`.
- Existing POS foundation is inherited once from release; fiscal-identity branch is NOT integrated.
- Main, original release branch and executor worktrees were not edited. Nothing was pushed.

## Semantic conflict resolution

| File / boundary | Resolution |
| --- | --- |
| `src/app/actions/orders.ts` | Replace geocoder/suggestions with PostgreSQL street/house/address-ID queries. Keep auth, consents, server payment availability, acceptance hours, location geometry and existing YooKassa call. |
| `src/components/cart/CartDrawer.tsx` | Whitelist selection fits current checkout. Keep current layout, total/fee, ASAP delivery, scheduled pickup, auth return and frontend polish. Changing street/house clears validation; response is keyed to address ID. |
| `src/lib/order-flow/service.ts` | Web calls whitelist RPC with ID/details; POS/status/payment engine remains unchanged. |
| `src/lib/order-schema.ts` | Require UUID for delivery, prohibit address for pickup; apartment/entrance/floor/intercom/comment remain optional. Keep receipt email/cart and delivery ASAP validation. |
| `AdminWorkspaceShell.tsx` | Keep release navigation and add address review. Remove duplicate icon import introduced by auto-merge. |
| Analytics fixture conflict | Preserve release fixture names/behavior; no analytics redesign or wholesale dirty POS diff. |
| Migration path / stale RPC | Move historical whitelist SQL through existing Git directory rename into `database/migrations`, preserving bytes. Add combined RPC migration, never restore the older payment overload. |

Two integration failures were found and corrected locally: the original whitelist wrapper tried
to replace an immutable snapshot after payment creation; repeated checkout could call the old
operational-order path and fail the unpaid KDS guard. Combined wrapper now delegates snapshot/fee
creation once and returns the existing canonical order/payment for an identical request. Changed
cart/address/email under the same key is rejected; no new charge is issued.

A real-adapter regression then found that first pickup on a new PostgreSQL connection could
reference an unassigned delivery record. A second additive migration uses initialized nullable
text/jsonb variables. The test exercises pickup FIRST, then delivery, through the real named RPC
adapter and order service, not just direct SQL or a mock transport.

## Runtime and business rules

- Runtime validation: PostgreSQL `delivery_addresses`; NO Yandex Geocoder, GeoSuggest or DaData.
- Server reloads enabled ID in the correct active location and rechecks DB coordinates against
  store settings/radius/excluded geometry. Browser coordinates/address text are not accepted.
- SQL repeats ID/location/enabled checks under a row lock and builds the immutable DB snapshot.
- Center candidate: longitude `38.055708`, latitude `55.909221`, Бахчиванджи 5Б.
- Radius: 3,000 m Haversine distance; exactly 3,000 m is inside. Aerodrome interior/boundary excluded.
- Existing OSM relation `3300255` polygon is byte-identical; not adjusted by eye. DB seed and importer
  geometry must remain aligned. Owner A1-A8 / H1-H12 review is still required before activation.
- Price: 200 RUB below 2,500 RUB discounted merchandise; free at/above 2,500; no merchandise minimum.
- Acceptance: 11:00-20:30 Europe/Moscow, inclusive 20:30 minute; delivery ASAP, promised <=60 minutes.
- Already-created order paid after cutoff continues to KDS on verified payment success. Opening
  checkout before cutoff without creating an order does not reserve acceptance. No new policy added.
- YooKassa only; unpaid/pending orders do not enter production KDS. Existing receipt pipeline retained.
- Delivery ready/courier_in_transit does NOT close the receipt; delivered closes it once. Paid delivery
  is a separate service item, free delivery has no zero-price item. Pickup closes at handed_out.
- Public display stays explicitly pickup-only and emits no customer address/phone/courier comment.
- Inventory/analytics retain canonical order semantics. Courier/fiscal retries add no sale or deduction.
- Legal/public copy: 3 km, 200 RUB, free from 2,500, no minimum, <=60 min, 11:00-20:30, online payment
  and availability by served-address list. Removed claims of Yandex address processing; consent version
  `2026-10-04.delivery-whitelist-v1`. No price/recipe production data was touched.

## Frozen manifest

Source artifacts remain outside tracked Git, in the whitelist executor's ignored output directory:

`/Users/akimkovalenko/.codex/worktrees/delivery-address-whitelist-main/KARIMOFF/outputs/delivery-whitelist-review-2026-10-03/`

| Artifact | Verified SHA-256 |
| --- | --- |
| raw-overpass.json | b34266b612678934877bdd405b3567bd59bf3c1677cea6711d8ec182017558e4 |
| approval-manifest.json | 253e5f3339807061771e46991645182a6a4bde95db796aa9d7e963930555ccbd |
| approval-candidate-ids.txt | 459c8d6218798d136a1073726fd79145f02f6345eb7bbd64998bf493d7d74534 |
| canonical candidate records, JSON plus newline | 192ef1a26b2fa5a50f3ee1994406e13e03825f8919d8c7b59cd54245515bf078 |

Snapshot `2026-10-03T13:13:20Z`: 2,757 source objects -> 2,460 unique addresses; 1,449 inside radius;
1,233 auto-approvable; 216 manual review; 1,011 outside. Initial subset is conservative (<2,800 m,
>100 m from exclusion, no ambiguity); it is NOT all houses inside 3 km or an official address register.
Manifest status remains PENDING OWNER APPROVAL. Checksum validity is not owner approval.

Dry run and LOCAL disposable import confirmed 1,233 enabled / 216 disabled / outside not seeded.
Importer verifies pinned manifest/source/ID/record checksums, snapshot metadata, coordinates and OSM IDs.
Unlisted candidates become disabled review. Remote apply requires frozen input, manifest and explicit pin.
No destructive deletes; existing admin-disabled/rejected entries stay disabled. No periodic Overpass job.
Public `/api/delivery-addresses/open-data` uses an explicit address-only SQL projection with OSM/ODbL
attribution; no customer/order data, apartment, intercom, phone or courier comment is selected.

### Future approved import, NOT executed against production

Run from the approved integration checkout. Securely inject DATABASE_URL; do not put its value in
Git, reports or shell history. Resolve the target location read-only first:

```sql
select id, location_key, name from public.order_locations
where location_key='karimoff-main' and is_default and is_active;
```

```sh
export REVIEW_DIR=/Users/akimkovalenko/.codex/worktrees/delivery-address-whitelist-main/KARIMOFF/outputs/delivery-whitelist-review-2026-10-03
# Preview only; no DB write.
node scripts/import-delivery-addresses.mjs \
  --input "$REVIEW_DIR/raw-overpass.json" \
  --approval-manifest "$REVIEW_DIR/approval-manifest.json" \
  --manifest-sha256 253e5f3339807061771e46991645182a6a4bde95db796aa9d7e963930555ccbd \
  --output outputs/approved-whitelist-preview

# ONLY after owner approval, correct location UUID, backup and migrations.
node scripts/import-delivery-addresses.mjs \
  --input "$REVIEW_DIR/raw-overpass.json" \
  --approval-manifest "$REVIEW_DIR/approval-manifest.json" \
  --manifest-sha256 253e5f3339807061771e46991645182a6a4bde95db796aa9d7e963930555ccbd \
  --output outputs/approved-whitelist-apply \
  --apply --allow-remote --location-id "$KARIMOFF_LOCATION_ID"
```

Verify counts scoped to target location/snapshot and that 216 manual rows remain disabled. Keep
DELIVERY_ENABLED=false and location/site coverage OFF during initial code deployment and seed review.
Do not wait for approval of every manual row; only approved served addresses may later be enabled.

## Migration and isolated evidence

Chronological additions after main:

1. `20260929150000_add_delivery_checkout_and_courier_status.sql`
2. `20260930120000_delivery_release_hardening.sql`
3. `20261003070000_runtime_role_permissions.sql`
4. `20261003180000_delivery_address_whitelist.sql`
5. `20261004120000_delivery_whitelist_release_integration.sql`
6. `20261004133000_whitelist_pickup_rpc_initialization.sql`

Historical whitelist SHA-256: `f0d2ab4a0e0e7d9cbbea5d32a7d2ccb4b50df3d06325a7f80f57045e79b7eb42`.
It is unchanged. All six are registered in the actual runner; Docker copies `database/migrations/`.
No DATABASE_URL fallback for DDL was reintroduced.

Local PostgreSQL 17: own container `karimoff-delivery-integration-pg-20261004`, loopback port 55445,
tmpfs data, no provider credentials or production connections. Existing shared containers/Colima
were not stopped or pruned. Port changes in test harnesses keep explicit local identity guards.

- Fresh: 31 migrations PASS; upgrade from fetched main's 25 migrations: PASS.
- Restricted runtime: CRUD/application queries PASS, no owned objects/superuser/CREATE rights;
  CREATE/ALTER/DROP fail with permission denied. Read-only startup verifies every migration.
- Local synthetic pg_dump/pg_restore: integrity matches products/orders/payments/receipts/users/
  inventory and 31 migration records. About 1.3 s / 665 KB, NOT a production RTO/RPO guarantee.
- Full suite: 415 passed, 0 failed, 0 skipped, including PostgreSQL suites.
- Address smoke: available YES, manual/disabled/unknown/wrong location/forged UUID NO; private-house
  apartment optional; pickup unchanged. Radius/polygon boundaries, price and cutoff tests retained.
- Payment/fiscal/KDS, concurrency/UNKNOWN-safe POS, analytics/inventory regressions PASS on fixtures.
- Lint, typecheck, application build PASS. Docker build and runtime evidence are recorded locally.
- Combined browser: 136 checks on 390x844, 430x932, 768x1024, 1024x768, 1440x900, 1920x1080;
  no overflow/JS errors. Includes whitelist checkout/fee/free delivery, profile, required modifier,
  sticky/footer, public screens and authenticated admin/orders/analytics/economics/POS/KDS/address review.
- Browser session/payment secrets are synthetic, provider fetch blocked; no order/payment submission.
  Chromium viewport emulation is NOT Safari/iPhone or real hardware/provider acceptance.
- npm audit --omit=dev still reports 2 high / 0 critical (forge/passkit); Wallet remains OFF, no
  dependency changes or forced fix. This bounded integration does not re-audit unrelated features.

Ignored local evidence: `outputs/integration-20261004/tests.tap`, `outputs/release-20261003/database/ready.json`,
`outputs/release-20261003/browser/results.json`, screenshots and runtime log. Timestamps/content are
from THIS combined worktree, despite the inherited directory name. Final Docker smoke and Git proof
are in `outputs/integration-20261004/`. Generated outputs are not committed.

## Real SELL handoff - blocked by read-only access

NO sanitized real SELL payload was obtained and NO fake file was created.
The planned file is `/Users/akimkovalenko/.codex/handoffs/KARIMOFF/evotor-real-sell-sanitized.json`.
It does not exist. Safe extraction/sanitization helper was prepared outside Git, but is not evidence.

Read-only attempts: old saved DB host could not resolve; current Timeweb cluster has private-only
access; legacy Supabase connection was unavailable; local existing snapshot had no SELL rows.
No cloud token could be obtained through the permitted read-only channel, so no Cloud GET was made.
No sync job, receipt, sale, refund, network-policy change or fabricated fiscal field occurred.
Owner was asked for safe read-only export/access. POS chat was informed of the missing file.
When supplied, preserve every actual pos_print_results group and actual fiscal identity/amount/time
fields, remove customer/loyalty/employee/contact/secret data, and hand over the exact outside-Git path.

## Controlled production preparation and decisions

Timeweb read-only app evidence: is_auto_deploy=false. Keep it OFF. Follow the updated
`docs/release/controlled-production-release.md`; that document authorizes no changes.

Required future preflight: fresh completed backup; approved private-network migration access;
scoped DDL ownership/credential; runtime DML-only identity; actual pending migration postconditions.
Preferred one-shot migrations with MIGRATION_DATABASE_URL on approved host, then runtime
RUNTIME_MIGRATIONS_READ_ONLY=true using DATABASE_URL. No wide CREATE/OWNER grant to karimoff_app.

First deployment flags: DELIVERY_ENABLED=false, EVOTOR_POS_PAYMENTS_ENABLED=false,
APPLE_WALLET_ENABLED=false. Preserve existing Evotor import/bridge, auth/encryption, S3 and YooKassa
configuration; do not copy fixture NODE_OPTIONS/credentials. No Yandex env addition is required.

After separate permission only: reviewed RC -> main, push main (auto-deploy still OFF), controlled
one-shot migration, manual exact-SHA deploy, health/public/read-only DB/staff smoke and observation.
Rollback means approved compatible application revision, never automatically restoring an older DB.

Pending POS handoff: `POS SOFTWARE READY FOR HARDWARE ACCEPTANCE: YES` plus final commit SHAs.
Fiscal-identity branch is deliberately not merged before that. Real provider/hardware acceptance
and owner boundary/manifest review remain separate activation gates.

- DELIVERY SOFTWARE INTEGRATED: YES.
- GENERAL RC READY AFTER DELIVERY MERGE: YES for software with new paid features OFF.
- READY FOR PRODUCTION DEPLOY: NOT YET; fresh backup and scoped DDL/private-network setup must
  pass preflight and owner must authorize migration/main integration/manual deploy.
- READY TO ENABLE DELIVERY: NO (owner boundary/manifest review, approved seed and real payment/receipt acceptance).
- READY TO ENABLE PHYSICAL POS: NO (final POS handoff and authorized real hardware/fiscal identity acceptance).

The missing real SELL evidence blocks that POS handoff, not the delivered whitelist software merge.
