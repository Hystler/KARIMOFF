# Controlled Production Release Plan

This document authorizes nothing. Every production change, main merge/push, deploy and
real provider/hardware operation still requires the owner's separate permission.
No permanent stage, paid resource or extra database is required for the local proofs.

## Required env plan

| Variable | Purpose / scope | Required | Secret |
| --- | --- | --- | --- |
| MIGRATION_DATABASE_URL | Migration job only; DDL role owns affected objects or scoped schema-owner membership | YES for DDL | YES |
| DATABASE_URL | Application karimoff_app connection; DML/sequence/RPC only | YES runtime | YES |
| RUNTIME_MIGRATIONS_READ_ONLY=true | Runtime verifies migrated schema and skips catalog/recipe data writes | YES first rollout | NO |
| DELIVERY_ENABLED=false | Master delivery activation gate | YES explicit OFF | NO |
| EVOTOR_POS_PAYMENTS_ENABLED=false | No new physical payment creation/dispatch; in-flight callback recovery stays allowed | YES explicit OFF | NO |
| APPLE_WALLET_ENABLED=false | Mitigate unresolved forge dependency by disabling pass generation | YES explicit OFF | NO |
| YANDEX_GEOCODER_API_KEY | Server HTTP Geocoder key; absent with delivery OFF is safe | Later delivery | YES |
| YANDEX_SUGGEST_API_KEY | Separate server GeoSuggest key | Later suggestions | YES |
| PAYMENTS_ENABLED / TEST_ORDER_MODE | Check existing intended live/test behavior, never infer mode from masked values | CHECK, no automatic change | NO |
| YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY | Existing shop mode/credentials; no test credential copied to production | CHECK | shop ID internal; key YES |
| YOOKASSA_WEBHOOK_URL / YOOKASSA_RETURN_URL | Existing HTTPS public callbacks and matching shop config | CHECK | NO |
| SESSION_SECRET / AUTH_RATE_LIMIT_SECRET | Preserve session/rate-limit keys; do not rotate as part of deployment | CHECK | YES |
| EVOTOR_TOKEN_ENCRYPTION_KEY / previous keys | Preserve ability to decrypt existing integrations and rollback | CHECK, no rotation | YES |
| EVOTOR_ENABLED / EVOTOR_BACKGROUND_SYNC | Preserve existing offline imports; unrelated to new physical POS gate | CHECK, no automatic disable | NO |
| EVOTOR_TERMINAL_BRIDGE_ENABLED / secret | Preserve existing pairing config; do not enable new payments | CHECK | flag NO; secret YES |
| S3_ENDPOINT / S3_REGION / S3_BUCKET / public URLs | Existing production media config, do not replace by local prefix | CHECK | NO values in report |
| S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY | Existing least-privilege object access | CHECK | YES |
| ORDER_STATUS_NOTIFICATIONS_ENABLED | Do not turn on client Telegram/MAX messages during rollout | CHECK | NO |

Do not add test fetch preloader NODE_OPTIONS or synthetic test credentials to Timeweb.

## Migration strategy and preflight

Preferred minimal path: run the **existing migration script as a separate controlled one-shot
operation** from an approved host with access to the DB, then start the application read-only.
This does not assume Timeweb supplies a native pre-deploy-job feature or create an extra resource.
If network access or one-shot execution is unavailable, agree explicitly on the existing
startup-runner alternative with separate MIGRATION_DATABASE_URL; runtime still uses DATABASE_URL.
Do not simply set read-only false and let karimoff_app attempt DDL.

Before the operation, using approved read-only access, inspect current_user/session_user,
search_path, schema public owner/ACL, relation/sequence owners, role membership and CREATE/USAGE.
Provision a DDL role with ownership of affected application objects or membership of a narrowly
scoped NOLOGIN application owner. No superuser or CREATE/OWNER grants to runtime.
Retain runtime CONNECT/USAGE, explicit table DML, sequence usage and selected function EXECUTE.
Do not blanket REASSIGN OWNED for an entire managed cluster or transfer unrelated extensions.
Review actual pending migration postconditions, not an assumed remote revision.

The application runner deliberately handles upgrade migrations; a true empty installation needs
the full chronological migration history, as demonstrated by the local harness. Production is an upgrade.

Future command, only after authorization, with secure credentials injected (not inline in history):

```sh
# From the approved exact RC checkout; MIGRATION_DATABASE_URL is supplied securely.
NODE_ENV=production RUNTIME_MIGRATIONS_READ_ONLY=false npm run db:runtime:migrate
```

Never run data migrations/menu-image scripts incidentally in this release: real prices/recipes
are not part of stabilization. Set runtime read-only true after schema migration succeeds.
New additive migrations beyond main: delivery checkout/status, delivery hardening, runtime role grants.
Historical main files are byte-identical. Live production may have additional pending main migrations;
operator must inspect actual postconditions before execution.

## Timeweb manual actions, in order

1. App Platform -> karimoff-production -> repository/deployment settings: verify automatic deployment remains OFF.
2. Managed PostgreSQL -> backups: obtain/verify a fresh completed pre-release backup. Latest API evidence
   is September 29 despite daily policy. Verify access and a production-sized restore procedure;
   the tiny local synthetic restore is not a production RTO guarantee.
3. PostgreSQL users/permissions: provision/check separate migration and runtime identities with approved SQL.
   Secret DSNs are entered securely, never pasted into reports or Git.
4. App Platform -> application environment variables: prepare runtime DATABASE_URL, read-only startup
   and three explicit OFF flags. Preserve existing integration/auth/S3 keys and callbacks.
5. After owner approval, coordinator merges the inspected RC into main and pushes main. No new POS cherry-pick.
6. Run the one-shot schema migration against the verified target using the DDL identity. Verify postconditions,
   grants and backward compatibility. Do this **before starting read-only RC**, not after its startup fails.
7. Manual deploy the exact approved main SHA. Automatic deployment stays OFF.
8. Check health/read-only DB product queries, public home/menu/product/login, anonymous access denial,
   authenticated staff/orders/analytics/POS/KDS/display without changing orders or prices.
9. Confirm delivery checkout cannot activate and physical Pay creates no command. Keep Wallet OFF.
10. Observe startup errors, permission-denied logs, outbox age, existing Evotor import freshness,
    payment/fiscal reconciliation backlog, health and UI errors. No load/fault tests in production.

No API env PATCH, database DDL, merge, push or manual deploy has been executed by this task.

## Rollback

Known platform successful revision: e478731. The failed main deploy 3a366ca is not the fallback.
Source review: e478731 honors RUNTIME_MIGRATIONS_READ_ONLY for schema verification and skips data
migrations in that mode. Additive delivery fields/tables and runtime grants do not require dropping data.
Preserve the existing encryption/session secrets, schema, callback config and integration identities.
Keep read-only startup true and remove migration credentials from runtime for the preferred job model.
Do not revert schema or restore an old database automatically: new real sales/orders would be lost.
Old app runtime against the actual production-upgraded schema still needs a controlled fallback smoke;
source compatibility/local new RC tests alone are not full old-version production proof.
Rollback triggers: repeated startup/health failure, permission regression in existing workflows,
unauthorized access, duplicate monetary dispatch, or inconsistent payment/fiscal/KDS state.
On suspected monetary inconsistency, stop new affected operations and reconcile existing state;
do not force re-charge or erase operations to make the UI green.

## Yandex activation preparation

1. In developer cabinet request HTTP Geocoder product/key; confirm license permits storing
   coordinates/address snapshots. Do not buy a tariff without owner approval.
2. Request separate GeoSuggest API key when suggestions are wanted.
3. Restrict server keys to fixed Timeweb egress IP(s); verify actual outbound IP before setting restriction.
4. Later place keys only in YANDEX_GEOCODER_API_KEY / YANDEX_SUGGEST_API_KEY server env.
5. Read-only geocode Бахчиванджи 5Б, verify center [38.0557080,55.9092210] rather than assume it.
6. Overlay store center, 3-km circle and existing OSM aerodrome polygon on actual Yandex map;
   accept conservative boundary and record disputed sections/screenshots. Never replace by a rough circle.
7. Test real address inside/outside/boundary/aerodrome with no real order creation.
8. Only separate owner approval enables store setting AND DELIVERY_ENABLED.

## Acceptance requiring later separate permissions

### YooKassa

One controlled paid order: correct merchandise/fee amount and receipt email, API-verified success,
one KDS entry, initial full_prepayment receipt. Pickup handed_out produces one closing receipt;
delivery ready/courier handoff does not, delivered produces one full_payment/prepayment settlement.
Verify actual shop VAT/subject/mode settings and registered receipt identifiers. No refunds by default.
This task performed no real payment/receipt/refund.

### Physical POS

1. Identify real bank payment device/acquirer separately from fiscal Evotor KKT and cloud API.
2. Confirm installed bridge version, pairing to the selected point/device, credentials and return contract.
3. Authorized controlled order on tablet: correct sum/positions -> specific device -> customer payment.
4. Verified result -> completed physical fiscalization -> durable receipt/fiscal identifiers stored.
5. Exactly one KDS business order, one inventory deduction at existing ready trigger, one canonical sale.
6. Import the physical document; confirm exact-ID mapping deduplicates it against KARIMOFF sale.
   The current confirmed-link tests do not create an automatic mapping guarantee.
7. Authorized decline/cancel and network interruption: UNKNOWN blocks re-charge, provider state is
   reconciled before any new monetary operation. Never double-charge just because an HTTP response is lost.
8. Identify actual acquiring provider/method from reliable device data, not the Evotor integration label.

Current software fallback is late callback/manual resolve; actual bank reconciliation and fiscal proof
are not independently proven. Keep physical POS payments OFF until this contract passes.

## Ownership and next actions

| Owner | Next bounded task | Dependency | Acceptance |
| --- | --- | --- | --- |
| Coordinator / infrastructure | Fresh backup + DDL ownership/credential/runtime-readonly setup | Explicit production permission | Fresh completed backup, correct owner, DML-only runtime, pending migrations identified |
| Coordinator | Approved merge/manual exact-SHA rollout | Previous row; owner permission | Health/catalog/staff smoke, all new paid features OFF |
| Delivery/backend + owner | Yandex keys/center/polygon read-only acceptance | Keys/license and map access | Confirmed coordinates/overlay and fail-closed address checks |
| POS/backend | Exact fiscal receipt-reference/import mapping and real acquirer metadata | Device return contract | One canonical sale after exact-ID import, no heuristic suppression |
| Owner + POS coordinator | Real hardware acceptance | Separate permission, previous POS row | Paid/fiscal/KDS/inventory/accounting exactly once, UNKNOWN-safe recovery |
| Owner + payments coordinator | Real YooKassa two-receipt acceptance | Separate permission, correct shop config | Registered receipt chain, no duplicate payment/sale |

Courier app, courier assignment, live location and Telegram/MAX delivery notifications are not
release blockers and remain out of this iteration.
