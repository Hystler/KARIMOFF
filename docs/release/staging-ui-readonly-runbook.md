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

Before changing any role or policy, run this read-only preflight. It must return
no rows; otherwise stop because the policies below rely on existing RLS and do
not enable RLS as part of this setup.

```sql
SELECT c.relname AS rls_not_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname::text = ANY (ARRAY[
    'products', 'product_images', 'product_ingredients', 'ingredients',
    'product_modifier_groups', 'product_modifier_options', 'site_settings',
    'audit_logs', 'order_locations', 'delivery_location_settings',
    'delivery_addresses'
  ])
  AND NOT c.relrowsecurity;
```

Create the role in the Timeweb UI if required, then run the grants/policies and
verification below as one transaction. Commit only if every required result is
empty/false; otherwise roll the transaction back and resolve the specific
privilege/RLS issue first. Do not point the stand at the role before this gate.

The SQL below is intended for the database owner. It grants reads only to the
catalogue and address data used by public browsing and checkout. The role gets
no access to customer/session/order/payment/receipt/staff/inventory data,
integration secrets, sequences, or application RPCs. For startup verification,
it gets only the `action` column for one migration marker in `audit_logs`,
filtered by a role-specific RLS policy. The only function grant below is
`pgcrypto.digest`.

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

-- Table-level REVOKE does not remove column-level grants. Clear those too so
-- rerunning the setup cannot leave a previously granted sensitive column.
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT n.nspname, c.relname,
      string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum) AS columns
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND a.attnum > 0 AND NOT a.attisdropped
    GROUP BY n.nspname, c.relname
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE %I.%I FROM %I',
      item.columns, item.nspname, item.relname, 'karimoff_staging_ro'
    );
  END LOOP;
END
$$;

-- Column-level grants match the actual server-side public catalogue queries.
-- In particular, inventory costs/package prices and internal recipe columns
-- are not exposed to the staging runtime role.
GRANT SELECT (
  id, created_at, updated_at, name, slug, category, description, price,
  image_url, is_active, sort_order, weight, tags, calories, protein, fat,
  carbs, allergens
) ON TABLE public.products TO karimoff_staging_ro;

GRANT SELECT (
  id, product_id, created_at, image_url, alt, sort_order, is_primary
) ON TABLE public.product_images TO karimoff_staging_ro;

GRANT SELECT (
  product_id, ingredient_id, quantity, unit, sort_order, is_removable,
  is_extra_available, extra_quantity, extra_price, max_extra_quantity
) ON TABLE public.product_ingredients TO karimoff_staging_ro;

GRANT SELECT (
  id, name, unit, nutrition_basis_quantity, calories_kcal, proteins_g,
  fats_g, carbohydrates_g
) ON TABLE public.ingredients TO karimoff_staging_ro;

GRANT SELECT (
  id, product_id, name, selection_type, min_selections, max_selections,
  sort_order, is_active
) ON TABLE public.product_modifier_groups TO karimoff_staging_ro;

GRANT SELECT (
  id, group_id, label, modifier_type, ingredient_id, replacement_ingredient_id,
  quantity_delta, unit, price_delta, kitchen_note, is_default, sort_order,
  is_active
) ON TABLE public.product_modifier_options TO karimoff_staging_ro;

GRANT SELECT (
  id, site_name, phone, address, working_hours, delivery_enabled,
  delivery_coverage_enabled, pickup_enabled, theme, loyalty_enabled,
  loyalty_percent, loyalty_redemption_limit_percent, payments_enabled,
  hero_title, hero_subtitle, home_hero_image_url, menu_hero_image_url,
  business_hero_image_url, careers_hero_image_url, franchise_hero_image_url,
  about_hero_image_url, telegram_url, tiktok_url
) ON TABLE public.site_settings TO karimoff_staging_ro;

-- The read-only migration verifier checks one historical marker. RLS limits
-- this column to that one action; no other audit fields or rows are readable.
GRANT SELECT (action) ON TABLE public.audit_logs TO karimoff_staging_ro;

GRANT SELECT (
  id, created_at, location_key, name, is_default, is_active
) ON TABLE public.order_locations TO karimoff_staging_ro;

GRANT SELECT (
  location_id, enabled, center_longitude, center_latitude, radius_meters,
  excluded_areas, delivery_fee, free_threshold, acceptance_start,
  acceptance_end, timezone, eta_minutes
) ON TABLE public.delivery_location_settings TO karimoff_staging_ro;

GRANT SELECT (
  id, location_id, city, street, street_normalized, house, house_normalized,
  building, building_normalized, display_name, postal_code, latitude, longitude,
  distance_meters, aerodrome_boundary_distance_meters, source, source_id,
  source_ids, source_snapshot_version, is_available, disabled_reason,
  review_reasons, duplicate_count
) ON TABLE public.delivery_addresses TO karimoff_staging_ro;

-- Minimal marker needed by the read-only migration postcondition verifier.
GRANT SELECT (version, pickup_rpc_initialized)
  ON TABLE public.delivery_whitelist_release_version TO karimoff_staging_ro;

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

DROP POLICY IF EXISTS staging_ui_migration_marker_read ON public.audit_logs;
CREATE POLICY staging_ui_migration_marker_read ON public.audit_logs
  FOR SELECT TO karimoff_staging_ro
  USING (action = 'schema_migration.20260828190000_refine_public_product_copy');

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

WITH RECURSIVE reachable_roles(role_oid) AS (
  SELECT membership.roleid
  FROM pg_auth_members membership
  JOIN pg_roles member ON member.oid = membership.member
  WHERE member.rolname = 'karimoff_staging_ro'
  UNION
  SELECT membership.roleid
  FROM pg_auth_members membership
  JOIN reachable_roles reachable ON reachable.role_oid = membership.member
)
SELECT parent.rolname AS inherited_or_settable_role
FROM reachable_roles reachable
JOIN pg_roles parent ON parent.oid = reachable.role_oid;

SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND has_table_privilege(
    'karimoff_staging_ro', c.oid,
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  );

-- This query must return no rows. It checks every effective column SELECT,
-- including privileges inherited through PUBLIC or role membership, against
-- the exact application read allowlist. Thus it also catches SELECT on any
-- private identity/session/order/payment/receipt/staff/audit/inventory object.
WITH allowed(table_name, columns) AS (
  VALUES
    ('products', ARRAY['id','created_at','updated_at','name','slug','category','description','price','image_url','is_active','sort_order','weight','tags','calories','protein','fat','carbs','allergens']),
    ('product_images', ARRAY['id','product_id','created_at','image_url','alt','sort_order','is_primary']),
    ('product_ingredients', ARRAY['product_id','ingredient_id','quantity','unit','sort_order','is_removable','is_extra_available','extra_quantity','extra_price','max_extra_quantity']),
    ('ingredients', ARRAY['id','name','unit','nutrition_basis_quantity','calories_kcal','proteins_g','fats_g','carbohydrates_g']),
    ('product_modifier_groups', ARRAY['id','product_id','name','selection_type','min_selections','max_selections','sort_order','is_active']),
    ('product_modifier_options', ARRAY['id','group_id','label','modifier_type','ingredient_id','replacement_ingredient_id','quantity_delta','unit','price_delta','kitchen_note','is_default','sort_order','is_active']),
    ('site_settings', ARRAY['id','site_name','phone','address','working_hours','delivery_enabled','delivery_coverage_enabled','pickup_enabled','theme','loyalty_enabled','loyalty_percent','loyalty_redemption_limit_percent','payments_enabled','hero_title','hero_subtitle','home_hero_image_url','menu_hero_image_url','business_hero_image_url','careers_hero_image_url','franchise_hero_image_url','about_hero_image_url','telegram_url','tiktok_url']),
    ('audit_logs', ARRAY['action']),
    ('order_locations', ARRAY['id','created_at','location_key','name','is_default','is_active']),
    ('delivery_location_settings', ARRAY['location_id','enabled','center_longitude','center_latitude','radius_meters','excluded_areas','delivery_fee','free_threshold','acceptance_start','acceptance_end','timezone','eta_minutes']),
    ('delivery_addresses', ARRAY['id','location_id','city','street','street_normalized','house','house_normalized','building','building_normalized','display_name','postal_code','latitude','longitude','distance_meters','aerodrome_boundary_distance_meters','source','source_id','source_ids','source_snapshot_version','is_available','disabled_reason','review_reasons','duplicate_count']),
    ('delivery_whitelist_release_version', ARRAY['version','pickup_rpc_initialized'])
), readable(table_name, column_name) AS (
  SELECT c.relname::text, a.attname::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('karimoff_staging_ro', c.oid, a.attnum, 'SELECT')
)
SELECT readable.table_name AS unexpected_select_table,
       readable.column_name AS unexpected_select_column
FROM readable
WHERE NOT EXISTS (
  SELECT 1 FROM allowed
  WHERE allowed.table_name = readable.table_name
    AND readable.column_name = ANY (allowed.columns)
);

-- This more legible subset must also return no rows: private business data.
SELECT c.relname AS forbidden_readable_table, a.attname AS readable_column
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND a.attnum > 0 AND NOT a.attisdropped
  AND c.relname::text = ANY (ARRAY[
    'customers', 'app_sessions', 'user_identities', 'orders', 'order_items',
    'verification_codes', 'legal_consents', 'cookie_consents', 'auth_rate_limits',
    'oauth_login_attempts', 'pending_social_identities', 'max_login_challenges',
    'payments', 'payment_events', 'refunds', 'fiscal_receipts', 'staff_users',
    'staff_location_access', 'order_notification_deliveries',
    'inventory_items', 'inventory_movements', 'evotor_devices', 'evotor_stores'
  ])
  AND has_column_privilege('karimoff_staging_ro', c.oid, a.attnum, 'SELECT');

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

-- No permissive PUBLIC policy may widen the row scope of an allowlisted table.
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = ANY (ARRAY[
    'products', 'product_images', 'product_ingredients', 'ingredients',
    'product_modifier_groups', 'product_modifier_options', 'site_settings',
    'audit_logs', 'order_locations', 'delivery_location_settings',
    'delivery_addresses'
  ])
  AND 'public' = ANY (roles);

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

SELECT c.relname AS missing_rls_table
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname::text = ANY (ARRAY[
    'products', 'product_images', 'product_ingredients', 'ingredients',
    'product_modifier_groups', 'product_modifier_options', 'site_settings',
    'audit_logs', 'order_locations', 'delivery_location_settings',
    'delivery_addresses'
  ])
  AND NOT c.relrowsecurity;

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
