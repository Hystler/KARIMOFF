import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import postgres from 'postgres';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = process.cwd();
const hasDisposableDatabase = /^postgres:\/\/karimoff_app@127\.0\.0\.1:55445\/karimoff_rc_fresh_\d+$/.test(
  process.env.KARIMOFF_RC_LOCAL_DSN ?? ''
);
const databaseTestOptions = {
  skip: hasDisposableDatabase ? false : 'Requires an isolated local KARIMOFF_RC_LOCAL_DSN database'
};

function loadTypeScript(relativePath, mocks) {
  const file = resolve(root, relativePath);
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText;
  const loadedModule = { exports: {} };
  new Function('require', 'exports', 'module', compiled)(specifier => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier.startsWith('node:')) return require(specifier);
    if (specifier.startsWith('./')) {
      const sibling = resolve(dirname(file), specifier);
      for (const extension of ['.ts', '.tsx', '.js']) {
        try {
          return loadTypeScript(`${sibling.slice(root.length + 1)}${extension}`, mocks);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
    }
    throw new Error(`Unexpected import in regression harness: ${specifier}`);
  }, loadedModule.exports, loadedModule);
  return loadedModule.exports;
}

function createInventoryApi(sql, getStaff) {
  return loadTypeScript('src/lib/inventory.ts', {
    'server-only': {},
    '@/lib/admin-auth': { getCurrentStaff: getStaff },
    '@/lib/database/errors': { formatMissingTableError: message => message ?? null },
    '@/lib/database/server': { createDatabaseServerClient: () => ({}) },
    '@/lib/postgres/server': { getPostgresSql: () => sql },
    './ingredients': { getAdminIngredients: async () => ({ ingredients: [], error: null, notConfigured: false }) }
  });
}

function createOrderAccessApi(sql, locations) {
  return loadTypeScript('src/lib/order-flow/access.ts', {
    'server-only': {},
    '@/lib/postgres/server': { getPostgresSql: () => sql },
    './queries': { getOrderLocations: async () => locations }
  });
}

test('inventory/production schema remains global where no reliable point key exists', databaseTestOptions, async () => {
  const dsn = process.env.KARIMOFF_RC_LOCAL_DSN;
  assert.match(dsn ?? '', /^postgres:\/\/karimoff_app@127\.0\.0\.1:55445\/karimoff_rc_fresh_\d+$/,
    'Run on a disposable local KARIMOFF_RC_LOCAL_DSN database');
  const sql = postgres(dsn, { max: 2, onnotice() {} });
  try {
    const globalTables = [
      'inventory_items',
      'production_recipes',
      'production_recipe_items',
      'production_recipe_expenses',
      'production_overheads',
      'production_runs',
      'production_run_items'
    ];
    const pointColumns = await sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any(${globalTables}::text[])
        and column_name in ('location_id', 'order_location_id', 'order_id')
      order by table_name, column_name
    `;
    assert.deepEqual(Array.from(pointColumns), []);

    const [inventoryLocation] = await sql`
      select data_type
      from information_schema.columns
      where table_schema = 'public' and table_name = 'inventory_items' and column_name = 'location'
    `;
    assert.equal(inventoryLocation.data_type, 'text');

    const indexes = await sql`
      select indexdef
      from pg_indexes
      where schemaname = 'public' and tablename = 'inventory_items'
        and indexdef ilike 'create unique index%'
        and indexdef ilike '%(ingredient_id)%'
    `;
    assert.ok(indexes.length, 'inventory_items remains one global row per ingredient');
  } finally {
    await sql.end();
  }
});

test('order-linked inventory movements are scoped by assigned order location; globals remain visible', databaseTestOptions, async () => {
  const dsn = process.env.KARIMOFF_RC_LOCAL_DSN;
  assert.match(dsn ?? '', /^postgres:\/\/karimoff_app@127\.0\.0\.1:55445\/karimoff_rc_fresh_\d+$/,
    'Run on a disposable local KARIMOFF_RC_LOCAL_DSN database');
  const sql = postgres(dsn, { max: 6, onnotice() {} });
  const suffix = randomUUID();
  const phoneToken = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(-7);
  const pointAKey = `scope-a-${suffix}`;
  const pointBKey = `scope-b-${suffix}`;
  const phoneA = `+7999${phoneToken}`;
  const phoneAB = `+7988${phoneToken}`;
  const phoneCashier = `+7977${phoneToken}`;
  const phoneCook = `+7966${phoneToken}`;
  let pointA;
  let pointB;
  let managerA;
  let managerAB;
  let cashier;
  let cook;
  let orderA;
  let orderB;
  let ingredient;
  let recipe;
  let productionRun;
  const movementIds = [];

  try {
    [pointA] = await sql`insert into public.order_locations (location_key, name, is_default)
      values (${pointAKey}, 'Synthetic scope point A', false) returning id`;
    [pointB] = await sql`insert into public.order_locations (location_key, name, is_default)
      values (${pointBKey}, 'Synthetic scope point B', false) returning id`;
    [managerA] = await sql`insert into public.staff_users (name, phone, password_hash, role, is_active)
      values ('Synthetic manager A', ${phoneA}, 'synthetic', 'manager', true) returning id`;
    [managerAB] = await sql`insert into public.staff_users (name, phone, password_hash, role, is_active)
      values ('Synthetic manager A+B', ${phoneAB}, 'synthetic', 'manager', true) returning id`;
    [cashier] = await sql`insert into public.staff_users (name, phone, password_hash, role, is_active)
      values ('Synthetic cashier', ${phoneCashier}, 'synthetic', 'cashier', true) returning id`;
    [cook] = await sql`insert into public.staff_users (name, phone, password_hash, role, is_active)
      values ('Synthetic cook', ${phoneCook}, 'synthetic', 'cook', true) returning id`;

    await sql`delete from public.staff_location_access where staff_id = any(${[managerA.id, managerAB.id, cashier.id, cook.id]}::uuid[])`;
    await sql`insert into public.staff_location_access (staff_id, location_key, order_location_id)
      values (${managerA.id}, ${`order:location:${pointA.id}`}, ${pointA.id})`;
    await sql`insert into public.staff_location_access (staff_id, location_key, order_location_id)
      values (${managerAB.id}, ${`order:location:${pointA.id}`}, ${pointA.id}),
             (${managerAB.id}, ${`order:location:${pointB.id}`}, ${pointB.id}),
             (${cashier.id}, ${`order:location:${pointA.id}`}, ${pointA.id}),
             (${cook.id}, ${`order:location:${pointA.id}`}, ${pointA.id})`;

    [orderA] = await sql`insert into public.orders (location_id, customer_name, customer_phone, total, source)
      values (${pointA.id}, 'Synthetic A', '00000000000', 100, 'pos') returning id`;
    [orderB] = await sql`insert into public.orders (location_id, customer_name, customer_phone, total, source)
      values (${pointB.id}, 'Synthetic B', '00000000000', 100, 'pos') returning id`;
    [ingredient] = await sql`insert into public.ingredients (name, unit, cost_per_unit)
      values (${`Synthetic scope ingredient ${suffix}`}, 'g', 1) returning id`;
    [recipe] = await sql`insert into public.production_recipes (name, output_ingredient_id)
      values (${`Synthetic global recipe ${suffix}`}, ${ingredient.id}) returning id`;
    [productionRun] = await sql`insert into public.production_runs (recipe_id, output_quantity, output_unit)
      values (${recipe.id}, 1, 'g') returning id`;

    let currentStaff = { id: managerA.id, role: 'manager', legacy: false };
    const inventory = createInventoryApi(sql, async () => currentStaff);
    const baselineMovementCount = (await inventory.getInventoryCards()).movementsToday;

    const [movementA] = await sql`insert into public.inventory_movements
      (ingredient_id, order_id, movement_type, quantity, unit, reason)
      values (${ingredient.id}, ${orderA.id}, 'sale', -1, 'g', 'Synthetic order A') returning id`;
    movementIds.push(movementA.id);
    const [movementB] = await sql`insert into public.inventory_movements
      (ingredient_id, order_id, movement_type, quantity, unit, reason)
      values (${ingredient.id}, ${orderB.id}, 'sale', -1, 'g', 'Synthetic order B') returning id`;
    movementIds.push(movementB.id);
    const [globalMovement] = await sql`insert into public.inventory_movements
      (ingredient_id, movement_type, quantity, unit, reason)
      values (${ingredient.id}, 'receipt', 4, 'g', 'Synthetic global receipt') returning id`;
    movementIds.push(globalMovement.id);
    const [productionMovement] = await sql`insert into public.inventory_movements
      (ingredient_id, production_run_id, movement_type, quantity, unit, reason)
      values (${ingredient.id}, ${productionRun.id}, 'production_output', 1, 'g', 'Synthetic global production') returning id`;
    movementIds.push(productionMovement.id);

    const expectedGlobalIds = [globalMovement.id, productionMovement.id].sort();
    const managerAResult = await inventory.getInventoryMovements();
    const managerAIds = new Set(managerAResult.movements.map(row => row.id));
    for (const id of [movementA.id, ...expectedGlobalIds]) assert.equal(managerAIds.has(id), true);
    assert.equal(managerAIds.has(movementB.id), false, 'order B is hidden without assigned location B');

    currentStaff = { id: managerAB.id, role: 'manager', legacy: false };
    const managerABResult = await inventory.getInventoryMovements();
    const managerABIds = new Set(managerABResult.movements.map(row => row.id));
    for (const id of movementIds) assert.equal(managerABIds.has(id), true);

    for (const role of ['owner', 'admin']) {
      currentStaff = { id: null, role, legacy: false };
      const allRows = await inventory.getInventoryMovements();
      const allIds = new Set(allRows.movements.map(row => row.id));
      for (const id of movementIds) assert.equal(allIds.has(id), true);
    }

    currentStaff = { id: managerA.id, role: 'manager', legacy: false };
    const dashboard = await inventory.getInventoryCards();
    assert.equal(dashboard.movementsToday, baselineMovementCount + 3, 'manager sees global movements plus assigned order movements only');

    for (const role of ['cashier', 'cook']) {
      currentStaff = { id: role === 'cashier' ? cashier.id : cook.id, role, legacy: false };
      const denied = await inventory.getInventoryMovements();
      assert.deepEqual(denied.movements, []);
      assert.match(denied.error ?? '', /Недостаточно прав/);
    }

    const testLocations = [
      { id: pointA.id, key: pointAKey, name: 'Synthetic A', isDefault: false },
      { id: pointB.id, key: pointBKey, name: 'Synthetic B', isDefault: false }
    ];
    const access = createOrderAccessApi(sql, testLocations);
    const managerAStaff = { id: managerA.id, role: 'manager', legacy: false };
    assert.equal(await access.canStaffAccessOrder(managerAStaff, orderA.id), true);
    assert.equal(await access.canStaffAccessOrder(managerAStaff, orderB.id), false, 'forged order B fails closed');
    assert.equal(await access.canStaffAccessOrderLocation(managerAStaff, pointA.id), true);
    assert.equal(await access.canStaffAccessOrderLocation(managerAStaff, pointB.id), false);
    for (const role of ['cashier', 'cook']) {
      const staff = { id: role === 'cashier' ? cashier.id : cook.id, role, legacy: false };
      assert.equal(await access.canStaffAccessOrderLocation(staff, pointA.id), true);
      assert.equal(await access.canStaffAccessOrderLocation(staff, pointB.id), false);
    }
  } finally {
    if (movementIds.length) await sql`delete from public.inventory_movements where id = any(${movementIds}::uuid[])`;
    const orderIds = [orderA?.id, orderB?.id].filter(Boolean);
    if (orderIds.length) {
      await sql`delete from public.order_outbox where aggregate_id = any(${orderIds}::uuid[])`;
      await sql`delete from public.orders where id = any(${orderIds}::uuid[])`;
    }
    if (productionRun?.id) await sql`delete from public.production_runs where id = ${productionRun.id}`;
    if (recipe?.id) await sql`delete from public.production_recipes where id = ${recipe.id}`;
    if (ingredient?.id) await sql`delete from public.ingredients where id = ${ingredient.id}`;
    const staffIds = [managerA?.id, managerAB?.id, cashier?.id, cook?.id].filter(Boolean);
    if (staffIds.length) await sql`delete from public.staff_users where id = any(${staffIds}::uuid[])`;
    const pointIds = [pointA?.id, pointB?.id].filter(Boolean);
    if (pointIds.length) await sql`delete from public.order_locations where id = any(${pointIds}::uuid[])`;
    await sql.end();
  }
});

test('inventory and production point-bound writes are absent; cashier/cook access remains excluded', () => {
  const inventoryActions = readFileSync(resolve(root, 'src/app/admin/inventory/actions.ts'), 'utf8');
  const productionActions = readFileSync(resolve(root, 'src/app/admin/production/actions.ts'), 'utf8');
  const inventoryPage = readFileSync(resolve(root, 'src/app/admin/inventory/movements/page.tsx'), 'utf8');
  const productionPage = readFileSync(resolve(root, 'src/app/admin/production/page.tsx'), 'utf8');
  const adminAuth = readFileSync(resolve(root, 'src/lib/admin-auth.ts'), 'utf8');
  const orderActions = readFileSync(resolve(root, 'src/app/admin/orders/actions.ts'), 'utf8');
  const kitchenActions = readFileSync(resolve(root, 'src/app/admin/kitchen/actions.ts'), 'utf8');
  const posActions = readFileSync(resolve(root, 'src/app/pos/actions.ts'), 'utf8');

  assert.match(inventoryPage, /isAdminAuthenticated/);
  assert.match(productionPage, /owner.*admin.*manager|owner.*manager.*admin/);
  assert.match(inventoryActions, /isAdminAuthenticated/);
  assert.match(productionActions, /\["owner", "admin", "manager"\]/);
  assert.match(adminAuth, /staff\?\.role === "owner" \|\| staff\?\.role === "admin" \|\| staff\?\.role === "manager"/);
  assert.match(orderActions, /canStaffAccessOrder\(staff, id\)/);
  assert.match(kitchenActions, /canStaffAccessOrderLocation\(staff, parsed\.data\.locationId\)/);
  assert.match(posActions, /canStaffAccessOrderLocation\(staff, parsed\.data\.locationId\)/);
  assert.doesNotMatch(inventoryActions, /formData\.get\("(?:order_id|location_id|order_location_id)"\)/);
  assert.doesNotMatch(productionActions, /formData\.get\("(?:order_id|location_id|order_location_id)"\)/);
});
