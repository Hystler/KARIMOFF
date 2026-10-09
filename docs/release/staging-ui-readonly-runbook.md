# Test Stand: Read-Only UI Mode

This runbook prepares the existing Timeweb test stand to use the same `main`
commit as production while keeping its differences in environment configuration.
It is a plan only: no database role, grant, policy, environment variable, or
deployment was changed while preparing it.

## Runtime Invariants

Set `STAGING_UI_MODE=true` only on the test stand. The application then:

- starts its PostgreSQL pool with `default_transaction_read_only=true`;
- does not start Evotor, YooKassa, or notification schedulers;
- uses an in-memory checkout demo customer; no customer/session row is created;
- returns a checkout preview before consent, order, payment, audit, event, or
  outbox write code can run;
- accepts cookie preference changes in browser storage only;
- disables YooKassa and Evotor POS execution even if provider credentials are
  accidentally present.

Database-level read-only credentials remain mandatory. The application guard is
defense in depth, not a substitute for the dedicated database role.

## Database Role

Run against the exact existing database the stand is intended to read only
after confirming its host and database name in Timeweb (the known shared DB is
`karimoff_migration`; verify it in the current app configuration). This role
does not create a copy or isolate production data; it only prevents the stand
from writing to the connected database. Do not use the migration credential as
the application credential. Create `karimoff_staging_ro` through Timeweb's
database user interface if the connected database owner cannot create roles.
Set its password in the secret manager/UI; never place it in this file or shell
history.

The SQL below is intended for the database owner. It grants reads only to the
catalogue and address data used by public browsing and checkout. The role gets
no access to customers, sessions, orders, payments, receipts, staff, inventory,
integration secrets, sequences, or application RPCs. The only function grant
below is `pgcrypto.digest` for the startup schema verifier.

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'karimoff_staging_ro') THEN
    CREATE ROLE karimoff_staging_ro
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END
$$;

ALTER ROLE karimoff_staging_ro
  NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
ALTER ROLE karimoff_staging_ro SET default_transaction_read_only = on;
REVOKE karimoff_app FROM karimoff_staging_ro;

GRANT CONNECT ON DATABASE karimoff_migration TO karimoff_staging_ro;
GRANT USAGE ON SCHEMA public TO karimoff_staging_ro;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM karimoff_staging_ro;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM karimoff_staging_ro;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM karimoff_staging_ro;

GRANT SELECT ON TABLE
  public.products,
  public.product_images,
  public.product_ingredients,
  public.ingredients,
  public.product_modifier_groups,
  public.product_modifier_options,
  public.site_settings,
  public.order_locations,
  public.delivery_location_settings,
  public.delivery_addresses,
  public.delivery_whitelist_release_version
TO karimoff_staging_ro;

-- The read-only migration verifier probes pgcrypto.digest; grant only that
-- function and its containing schema, wherever the extension is installed.
DO $$
DECLARE extension_schema text;
BEGIN
  SELECT n.nspname INTO extension_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';
  IF extension_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto must be installed before configuring the staging role';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO karimoff_staging_ro', extension_schema);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.digest(text,text) TO karimoff_staging_ro', extension_schema);
END
$$;

-- Add role-specific policies, but do not enable/disable RLS on shared tables.
-- These policies apply only where RLS is already enabled and do not change
-- visibility for existing application roles.

DROP POLICY IF EXISTS staging_ui_products_read ON public.products;
CREATE POLICY staging_ui_products_read ON public.products
  FOR SELECT TO karimoff_staging_ro USING (is_active);

DROP POLICY IF EXISTS staging_ui_product_images_read ON public.product_images;
CREATE POLICY staging_ui_product_images_read ON public.product_images
  FOR SELECT TO karimoff_staging_ro USING (
    EXISTS (SELECT 1 FROM public.products p WHERE p.id = public.product_images.product_id AND p.is_active)
  );

DROP POLICY IF EXISTS staging_ui_product_ingredients_read ON public.product_ingredients;
CREATE POLICY staging_ui_product_ingredients_read ON public.product_ingredients
  FOR SELECT TO karimoff_staging_ro USING (
    EXISTS (SELECT 1 FROM public.products p WHERE p.id = public.product_ingredients.product_id AND p.is_active)
  );

DROP POLICY IF EXISTS staging_ui_ingredients_read ON public.ingredients;
CREATE POLICY staging_ui_ingredients_read ON public.ingredients
  FOR SELECT TO karimoff_staging_ro USING (
    EXISTS (
      SELECT 1 FROM public.product_ingredients pi
      JOIN public.products p ON p.id = pi.product_id
      WHERE pi.ingredient_id = ingredients.id AND p.is_active
    )
  );

DROP POLICY IF EXISTS staging_ui_modifier_groups_read ON public.product_modifier_groups;
CREATE POLICY staging_ui_modifier_groups_read ON public.product_modifier_groups
  FOR SELECT TO karimoff_staging_ro USING (
    is_active AND EXISTS (
      SELECT 1 FROM public.products p WHERE p.id = public.product_modifier_groups.product_id AND p.is_active
    )
  );

DROP POLICY IF EXISTS staging_ui_modifier_options_read ON public.product_modifier_options;
CREATE POLICY staging_ui_modifier_options_read ON public.product_modifier_options
  FOR SELECT TO karimoff_staging_ro USING (
    is_active AND EXISTS (
      SELECT 1 FROM public.product_modifier_groups g
      JOIN public.products p ON p.id = g.product_id
      WHERE g.id = public.product_modifier_options.group_id AND g.is_active AND p.is_active
    )
  );

DROP POLICY IF EXISTS staging_ui_site_settings_read ON public.site_settings;
CREATE POLICY staging_ui_site_settings_read ON public.site_settings
  FOR SELECT TO karimoff_staging_ro USING (id = 'main');

DROP POLICY IF EXISTS staging_ui_default_location_read ON public.order_locations;
CREATE POLICY staging_ui_default_location_read ON public.order_locations
  FOR SELECT TO karimoff_staging_ro USING (
    location_key = 'karimoff-main' AND is_default AND is_active
  );

DROP POLICY IF EXISTS staging_ui_delivery_settings_read ON public.delivery_location_settings;
CREATE POLICY staging_ui_delivery_settings_read ON public.delivery_location_settings
  FOR SELECT TO karimoff_staging_ro USING (
    EXISTS (
      SELECT 1 FROM public.order_locations l
      WHERE l.id = location_id AND l.location_key = 'karimoff-main'
        AND l.is_default AND l.is_active
    )
  );

DROP POLICY IF EXISTS staging_ui_available_addresses_read ON public.delivery_addresses;
CREATE POLICY staging_ui_available_addresses_read ON public.delivery_addresses
  FOR SELECT TO karimoff_staging_ro USING (
    is_available AND EXISTS (
      SELECT 1 FROM public.order_locations l
      WHERE l.id = location_id AND l.location_key = 'karimoff-main'
        AND l.is_default AND l.is_active
    )
  );
```

Do not grant membership in `karimoff_app`, and do not grant `EXECUTE` on
application RPCs. The role-level and connection-level read-only defaults are
defense in depth, not a replacement for the table ACL and function checks
below. PostgreSQL users can change session defaults, so the role must have no
table write privileges and no callable `SECURITY DEFINER` write function.

Before switching `DATABASE_URL`, run these checks as a database administrator.
Every query must return `false`/no rows as indicated. In particular, reject
the setup if the role is a member of any other role, has any table write
privilege, or can execute a `SECURITY DEFINER` function. The known mutating
application functions are invoker-security and must remain inaccessible for
writes through the role's table ACLs; trigger functions are not directly
callable and their public `EXECUTE` is revoked by their migrations.

```sql
SELECT pg_has_role('karimoff_staging_ro', 'karimoff_app', 'MEMBER') AS is_app_member;

SELECT parent.rolname AS inherited_role
FROM pg_auth_members membership
JOIN pg_roles parent ON parent.oid = membership.roleid
JOIN pg_roles member ON member.oid = membership.member
WHERE member.rolname = 'karimoff_staging_ro';

SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND has_table_privilege(
    'karimoff_staging_ro', c.oid,
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  );

SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'S'
  AND has_sequence_privilege('karimoff_staging_ro', c.oid, 'USAGE,UPDATE');

SELECT p.oid::regprocedure AS callable_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND has_function_privilege('karimoff_staging_ro', p.oid, 'EXECUTE');

SELECT has_database_privilege('karimoff_staging_ro', current_database(), 'CREATE') AS database_create,
       has_schema_privilege('karimoff_staging_ro', 'public', 'CREATE') AS schema_create;

SELECT n.nspname AS owned_schema
FROM pg_namespace n
JOIN pg_roles r ON r.oid = n.nspowner
WHERE r.rolname = 'karimoff_staging_ro';

SELECT n.nspname, c.relname AS owned_object
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles r ON r.oid = c.relowner
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND r.rolname = 'karimoff_staging_ro';

SELECT d.datname AS owned_database
FROM pg_database d
JOIN pg_roles r ON r.oid = d.datdba
WHERE r.rolname = 'karimoff_staging_ro';
```

The database/schema `CREATE` values must both be `false`; the membership,
write-privilege, callable-security-definer, sequence-privilege, and ownership
queries must return no rows. If any check fails, do not point the test stand at
this role; resolve the specific inherited grant first without weakening the
app role.

Before changing the stand's `DATABASE_URL`, verify the role attributes,
`has_database_privilege(..., 'CREATE') = false`,
`has_schema_privilege(..., 'public', 'CREATE') = false`, and record the existing
RLS state for each listed table. Do not enable or disable RLS on shared tables
as part of this setup. The staging policies apply only where RLS is already
enabled; on non-RLS catalogue tables the application still filters active
products server-side and table grants remain SELECT-only.
Use metadata checks above to verify the shared database role; do not issue
mutation probes against the shared production database. If an execution-level
negative test is required, run it only against a disposable local database
restored from a sanitized backup. On the stand, verify the connection reports
`current_user = 'karimoff_staging_ro'` and
`current_setting('transaction_read_only') = 'on'`, then smoke only the allowed
catalogue/address SELECTs.

The staging startup migration verifier checks only that
`public.user_identities` exists for the 20261008120000 data-only compliance
migration. It deliberately does not inspect identity rows; the test role must
not receive access to that personal data. All other registered migration
postconditions remain checked by the read-only runner.

No default table privileges are added. If a future migration adds a table or
column needed by the public UI, review and grant only that specific read before
using it on the stand.

## Timeweb Test-Stand Environment

After the SQL and a separate credential review, update only the test stand:

| Variable | Test-stand value | Purpose |
| --- | --- | --- |
| `STAGING_UI_MODE` | `true` | Demo checkout, payment hard block, read-only pool, no schedulers |
| `DATABASE_URL` | DSN for `karimoff_staging_ro` on the verified shared DB | Read-only application access |
| `RUNTIME_MIGRATIONS_READ_ONLY` | `true` | Startup validates schema without DDL |
| `DELIVERY_ENABLED` | `true` | UI-only availability override; whitelist/zone checks remain active |
| `PAYMENTS_ENABLED` | `false` | Explicitly disable checkout payments |
| `TEST_ORDER_MODE` | `true` | Additional non-production guard |
| `EVOTOR_POS_PAYMENTS_ENABLED` | `false` | Disable physical terminal payments |
| `EVOTOR_ENABLED` | `false` | Disable Evotor integration on the stand |
| `EVOTOR_BACKGROUND_SYNC` | `false` | No background Evotor sync |
| `EVOTOR_TERMINAL_BRIDGE_ENABLED` | `false` | Disable terminal bridge independently of code guards |
| `ORDER_STATUS_NOTIFICATIONS_ENABLED` | `false` | Do not dispatch customer notifications |
| `APPLE_WALLET_ENABLED` | `false` | Keep Wallet disabled |
| `MIGRATION_DATABASE_URL` | unset | No migration credential in normal stand runtime |

Keep `STAGING_UI_MODE` unset or `false` in production. Do not change production
flags, credentials, database roles, or shared delivery settings for this mode.

## Rollback

To disable the stand mode, first set its `STAGING_UI_MODE=false`; keep its
database credential read-only until a separate decision is made. If removing
the role, revoke only the grants and drop only the `staging_ui_*` policies
listed above, then reset the role setting. Do not use `DROP OWNED` or change
policies/grants for `karimoff_app`.
