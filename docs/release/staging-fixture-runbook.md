# Autonomous Staging UI Fixtures

This is UI/UX acceptance only, not database, payment or hardware acceptance.
Production and staging use the same main commit. No role/grant/RLS changes are
needed; leave the existing staging role alone.

## Isolation

Enable BOTH `STAGING_UI_MODE=true` and `STAGING_DATA_MODE=fixture` only on
`timeweb-cutover-test`. The production default is unchanged. Fixture data access
requires both flags. Startup fails if fixture mode is configured without UI mode.
The PostgreSQL pool refuses every connection whenever fixture data mode is set,
even if accidental database credentials are present. Both startup migration
scripts exit without opening a connection in the explicit fixture mode.

The existing staging guards disable authentication writes, consent persistence,
orders, payments, staff mutations, terminal APIs and background schedulers.
Checkout uses an in-memory demo customer and returns only a preview. Cart product,
modifier, address and location IDs are validated server-side; unknown IDs fail
closed. Demo catalog has no modifier/ingredient snapshot, so these IDs are rejected.

## Public Data

Catalog: existing `demoProducts` from `data/import/juikaifui-products.json` and
public catalog copy/media. This is a demo catalog, not current DB stock/prices.

Approved addresses: `data/staging/approved-addresses.json`, fetched by GET from
the existing stand's `/api/delivery-addresses/open-data`. Exactly 1233 approved
rows; the 216 manual-review rows are absent and cannot be selected. Metadata
records the export URL/time, original response SHA-256 and source snapshot version.
No customer/order/private fields are included. Synthetic IDs are namespaced
deterministic UUIDs, not shared DB identifiers.

Attribution: © OpenStreetMap contributors. Address extract licensed under
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
The fixture open-data route preserves this notice. The aerodrome polygon is
copied without changing coordinates from the existing public OSM-derived release
migration (relation 3300255); this does not replace owner boundary review.
Updates are manual/on-demand, never periodic Overpass polling.

Geometry: center `[38.0557080, 55.9092210]`, 3000 m inclusive, airfield excluded.
Pricing: 200 RUB, free at goods subtotal >=2500 RUB, no minimum. ETA 60 minutes.
Hours: 11:00–20:30 inclusive Europe/Moscow. Outside these hours delivery preview
is blocked; pickup preview still works. No special clock override is shipped.

## Test Stand Environment After Approved Merge

Set only on `timeweb-cutover-test`:

```dotenv
STAGING_UI_MODE=true
STAGING_DATA_MODE=fixture
RUNTIME_MIGRATIONS_READ_ONLY=true
DELIVERY_ENABLED=true
PAYMENTS_ENABLED=false
TEST_ORDER_MODE=true
EVOTOR_ENABLED=false
EVOTOR_POS_PAYMENTS_ENABLED=false
EVOTOR_BACKGROUND_SYNC=false
EVOTOR_TERMINAL_BRIDGE_ENABLED=false
ORDER_STATUS_NOTIFICATIONS_ENABLED=false
APPLE_WALLET_ENABLED=false
MAINTENANCE_MODE=false
```

REMOVE stand bindings for `DATABASE_URL`, `MIGRATION_DATABASE_URL`, any legacy DB
credentials, YooKassa/Evotor credentials, social OAuth/bot secrets and S3 write
credentials. Do not delete global variables or bindings of the production app.
Local fixture images need no S3 credentials. Set `APP_ORIGIN` to the stand origin.
Retain only stand-specific harmless configuration and any required separate
session-secret value; never reuse a production secret unnecessarily.

Immediately before redeploy, fetch main and record exact SHA. Keep production
auto-deploy OFF. Deploy only this existing stand after reviewing its env bindings.
No production application deployment, migration, seed, DB credential or flag change.

## Timeweb Automation Capabilities

Official API specification checked:
[Timeweb Cloud OpenAPI](https://github.com/timeweb-cloud/sdk-go/blob/main/api/openapi.yaml).
App API supports GET `/api/v1/apps/{app_id}`, PATCH settings with `envs`, and
POST `/api/v1/apps/{app_id}/deploy` with `commit_sha`. Bearer token is required.
The inspected published specification contains no stand-management endpoints.
Do NOT call the parent production app's PATCH/deploy endpoints to manage a stand.
Do NOT guess private stand endpoints or extract browser session credentials.

For this nested stand (`app 229491`, `stand 2587`), use the authenticated Timeweb
stand Settings UI if public API support remains unavailable:
[stand settings](https://timeweb.cloud/my/apps/229491/stands/2587).
Official [stand docs](https://timeweb.cloud/docs/apps/stands) describe independent
env/branch/commit controls. An API token alone does not establish stand API support.
If API support is added, verify the target name/ID and capabilities read-only first;
secrets must remain in a protected store/process memory, never arguments or logs.

## Acceptance

1. Health 200, catalog/images/prices, product detail and cart at 390/768/1440 px.
2. Checkout demo without registration; pickup preview succeeds.
3. 1233 approved addresses, normalized street search and house selection.
4. Forged/disabled/wrong-location address rejected; existing geometry/hours upheld.
5. Fee 2499→200, 2500→0, 2501→0; ETA/window displayed; delivery preview in hours.
6. Provider/terminal APIs remain blocked even with accidental payment flags/keys.
7. No DB connection is possible; no session/customer/order/payment/audit/outbox or
   inventory writes. A DB-less process cannot invoke DB SECURITY DEFINER functions.

The previously disclosed migrator password still requires a separately authorized
rotation with dependent credentials updated safely. This setup neither uses it
nor changes production env.
