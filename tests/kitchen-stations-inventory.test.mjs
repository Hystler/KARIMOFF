import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

const migration = readFileSync("supabase/migrations/20260911163830_kitchen_stations_and_pilot_inventory_policy.sql", "utf8");
const dsn = process.env.KITCHEN_TEST_DATABASE_URL;
const localOnly = { skip: !dsn && "Requires explicit disposable 55440 KITCHEN_TEST_DATABASE_URL" };
const rollback = new Error("ROLLBACK_KITCHEN_FIXTURE");

function load(path, imports = {}, env = {}) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  new Function("require", "exports", "process", code)((id) => {
    if (id in imports) return imports[id];
    throw new Error(`Unexpected import: ${id}`);
  }, exports, { env });
  return exports;
}

function service(sql, isTest = false) {
  return load("src/lib/order-flow/service.ts", {
    "server-only": {},
    "@/lib/postgres/server": { getPostgresSql: () => ({ begin: (callback) => sql.savepoint(callback) }) },
    "@/lib/observability": { logOperationalEvent() {} },
    "@/lib/database/server": {}
  }, { TEST_ORDER_MODE: String(isTest) });
}

async function withFixture(run, options = {}) {
  assert.equal(dsn, "postgres://postgres@127.0.0.1:55440/karimoff_audit", "Never use shared or old audit databases");
  const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice() {} });
  try {
    const [identity] = await sql`select current_database() as name,
      to_regclass('local_audit.applied_migrations') is not null as disposable`;
    assert.deepEqual(identity, { name: "karimoff_audit", disposable: true });
    await sql.begin(async (tx) => {
      const fixture = await createFixture(tx, options);
      await run(tx, fixture);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await sql.end({ timeout: 5 }); }
}

async function createFixture(sql, { stock = 0, policy, categories = ["Бургеры", "Снэки"], isTest = false, missingStock = false } = {}) {
  const [location] = await sql`insert into public.order_locations (location_key, name)
    values (${`kitchen-regression-${randomUUID()}`}, 'Kitchen regression fixture') returning id`;
  if (policy) await sql`insert into public.kitchen_sla_settings (location_id, inventory_shortage_policy) values (${location.id}, ${policy})`;
  const [ingredient] = await sql`insert into public.ingredients (name, unit, cost_per_unit)
    values ('Kitchen regression ingredient', 'g', 1) returning id`;
  if (!missingStock) await sql`insert into public.inventory_items (ingredient_id, unit, current_quantity)
    values (${ingredient.id}, 'g', ${stock}) on conflict (ingredient_id) do update set current_quantity = excluded.current_quantity`;
  else await sql`delete from public.inventory_items where ingredient_id = ${ingredient.id}`;
  const products = [];
  for (const category of categories) {
    const [product] = await sql`insert into public.products (name, slug, category, price, is_active)
      values ('Kitchen regression meal', ${`kitchen-regression-${randomUUID()}`}, ${category}, 100, true) returning id`;
    await sql`insert into public.product_ingredients (product_id, ingredient_id, quantity, unit)
      values (${product.id}, ${ingredient.id}, 10, 'g')`;
    products.push(product);
  }
  const [created] = await sql`select * from public.create_pos_order_atomic(
    ${location.id}::uuid, 'Kitchen regression guest', null,
    ${sql.json(products.map((product) => ({ product_id: product.id, quantity: 2 })))}::jsonb,
    ${randomUUID()}::uuid, null::uuid, 'owner', 'asap', null::timestamptz, ${isTest}, null::uuid)`;
  const advance = (station, status, actorRole = "cook") => service(sql, isTest).transitionOrder({
    orderId: created.order_id, station, status, actorRole, actorId: null, deviceSource: 'kitchen-regression'
  });
  const snapshot = async () => {
    const [row] = await sql`select o.kitchen_status, o.payment_status, o.fiscal_status,
      (select current_quantity::text from public.inventory_items where ingredient_id = ${ingredient.id}) as balance,
      (select count(*)::int from public.order_inventory_deductions where order_id = o.id) as deductions,
      (select count(*)::int from public.inventory_movements where order_id = o.id) as movements,
      (select coalesce(sum(quantity), 0)::text from public.inventory_movements where order_id = o.id) as movement_quantity,
      (select count(*)::int from public.order_status_events where order_id = o.id and to_status = 'ready') as ready_events,
      (select count(*)::int from public.order_outbox where aggregate_id = o.id and event_type = 'order.station_changed') as station_events,
      (select count(*)::int from public.fiscal_receipts where order_id = o.id) as receipts
      from public.orders o where o.id = ${created.order_id}`;
    return row;
  };
  return { orderId: created.order_id, locationId: location.id, ingredientId: ingredient.id, products, advance, snapshot };
}

test("two station views partition lines and never report a mixed order fully ready early", () => {
  const { kitchenStations, stationItems, stationStatus, kitchenViewStatus, kitchenStationForCategory } = load("src/lib/order-flow/kitchen-stations.ts");
  assert.deepEqual(kitchenStations, ["snacks", "main"]);
  for (const category of ['Хот-Доги', 'хот дог', 'хотдог', 'Hot Dogs', 'hot-dogs']) {
    assert.equal(kitchenStationForCategory(category), 'main', category);
  }
  const order = { kitchenStatus: "cooking", items: [
    { id: "a", kitchenStation: "main", kitchenStatus: "ready" },
    { id: "b", kitchenStation: "snacks", kitchenStatus: "new" }
  ] };
  assert.equal(stationItems(order, "all").length, 2);
  assert.equal(stationItems(order, "snacks")[0].id, "b");
  assert.equal(kitchenViewStatus(order, "all"), "cooking");
  assert.equal(kitchenViewStatus(order, "main"), "ready");
  assert.equal(kitchenViewStatus(order, "snacks"), "new");
  assert.equal(stationStatus([]), "new");
});

test("forward SQL retains existing loyalty accounting and protected commercial lines", () => {
  const old = readFileSync("supabase/migrations/20260728083046_add_staff_kitchen_modifiers_scheduling_and_registers.sql", "utf8");
  const loyalty = (source) => source.slice(source.indexOf("    select loyalty_enabled, loyalty_percent"), source.indexOf("  insert into public.audit_logs (", source.indexOf("    select loyalty_enabled, loyalty_percent")));
  assert.equal(loyalty(migration), loyalty(old));
  assert.doesNotMatch(migration, /update public\.order_items|disable trigger|security definer/i);
  assert.match(migration, /default 'allow_negative'/);
});

test("55440: real mixed order, zero stock, repeated station ready and handout deduct exactly once", localOnly, async () => {
  await withFixture(async (sql, f) => {
    await sql`set local role karimoff_app`;
    await f.advance("main", "cooking");
    await f.advance("main", "ready");
    let row = await f.snapshot();
    assert.equal(row.kitchen_status, "cooking");
    assert.equal(row.deductions, 0);
    assert.equal(Number(row.balance), 0);
    assert.equal((await f.advance("main", "ready")).already_applied, true);
    assert.equal((await f.advance("main", "cooking")).already_applied, true);
    await assert.rejects(service(sql).transitionOrder({ orderId: f.orderId, status: "ready", actorId: null, actorRole: "owner", deviceSource: "kds" }), /каждой станции/);
    await f.advance("snacks", "cooking");
    const done = await f.advance("snacks", "ready");
    assert.ok(done.warnings.some((warning) => warning.includes("дефицитом")));
    row = await f.snapshot();
    assert.equal(row.kitchen_status, "ready");
    assert.equal(Number(row.balance), -40);
    assert.equal(Number(row.movement_quantity), -40);
    assert.equal(row.deductions, 1);
    assert.equal(row.movements, 1);
    assert.equal(row.ready_events, 1);
    assert.equal(row.station_events, 4);
    assert.equal(row.receipts, 0);
    const before = { ...row };
    await f.advance("snacks", "ready");
    await f.advance("main", "ready");
    assert.deepEqual(await f.snapshot(), before);
    const legacy = service(sql);
    const handout = () => legacy.transitionOrder({ orderId: f.orderId, status: "handed_out", actorId: null, actorRole: "owner", deviceSource: "kds" });
    await assert.rejects(handout(), /Оплата не подтверждена/);
    await sql`update public.orders set payment_status = 'paid' where id = ${f.orderId}`;
    await handout();
    await handout();
    assert.equal((await f.snapshot()).deductions, 1);
    const [audit] = await sql`select metadata from public.audit_logs where entity_id = ${f.orderId} and action = 'order.status_change' and metadata->>'to' = 'completed'`;
    assert.equal(audit.metadata.inventory_shortage_policy, "allow_negative");
    assert.ok(audit.metadata.inventory_deficits);
  });
});

test("55440: block mode rolls back final station and accounting; reversible pilot setting succeeds", localOnly, async () => {
  await withFixture(async (sql, f) => {
    await f.advance("main", "cooking");
    await f.advance("snacks", "cooking");
    await f.advance("main", "ready");
    const before = await f.snapshot();
    await assert.rejects(f.advance("snacks", "ready"), /Недостаточно остатков/);
    assert.deepEqual(await f.snapshot(), before);
    const [line] = await sql`select work.status from public.order_item_kitchen_state work
      join public.order_items item on item.id = work.order_item_id where item.order_id = ${f.orderId} and work.station = 'snacks'`;
    assert.equal(line.status, "cooking");
    await sql`update public.kitchen_sla_settings set inventory_shortage_policy = 'allow_negative' where location_id = ${f.locationId}`;
    await f.advance("snacks", "ready");
    assert.equal(Number((await f.snapshot()).balance), -40);
    await sql`update public.kitchen_sla_settings set inventory_shortage_policy = 'block' where location_id = ${f.locationId}`;
    assert.equal((await f.advance("snacks", "ready")).already_applied, true);
    assert.equal((await f.snapshot()).deductions, 1);
  }, { stock: 0, policy: "block" });
});

test("55440: strict mode succeeds at exact stock and negative stock is not clamped", localOnly, async () => {
  for (const [policy, stock, expected] of [["block", 40, 0], ["allow_negative", 7, -33], ["allow_negative", -10, -50]]) {
    await withFixture(async (_sql, f) => {
      for (const station of ["main", "snacks"]) { await f.advance(station, "cooking"); await f.advance(station, "ready"); }
      assert.equal(Number((await f.snapshot()).balance), expected);
      assert.equal((await f.snapshot()).deductions, 1);
    }, { policy, stock });
  }
});

test("55440: missing stock row is materialized and full immutable snapshot is consumed", localOnly, async () => {
  await withFixture(async (sql, f) => {
    await sql`update public.product_ingredients set quantity = 99 where ingredient_id = ${f.ingredientId}`;
    for (const station of ["main", "snacks"]) { await f.advance(station, "cooking"); await f.advance(station, "ready"); }
    assert.equal(Number((await f.snapshot()).balance), -40, "Use order snapshots, not edited recipes");
    assert.equal(Number((await f.snapshot()).movement_quantity), -40);
  }, { missingStock: true });
});

test("55440: drinks, sauces and unknown categories need only the snacks employee; rolls belong to mains", localOnly, async () => {
  await withFixture(async (sql, f) => {
    const mapped = await sql`select public.kitchen_station_for_category(category) as station
      from unnest(array['Бургеры','Шаурма','shawarma','Роллы','rolls','Снэки','Напитки','Соусы','unknown']) category`;
    assert.deepEqual(mapped.map((row) => row.station), ['main','main','main','main','main','snacks','snacks','snacks','snacks']);
    await f.advance("main", "cooking");
    await f.advance("main", "ready");
    await f.advance("snacks", "cooking");
    await f.advance("snacks", "ready");
    assert.equal((await f.snapshot()).kitchen_status, "ready");
    assert.equal(Number((await f.snapshot()).balance), -80);
  }, { categories: ["Роллы", "Снэки", "Напитки", "Соусы"] });
});

test("55440: unauthorized roles, invalid stations, premature ready and test/prod mismatch stay blocked", localOnly, async () => {
  await withFixture(async (sql, f) => {
    await assert.rejects(f.advance("main", "ready"), /Сначала начните/);
    await assert.rejects(f.advance("main", "cooking", "cashier"), /Недостаточно прав/);
    await assert.rejects(f.advance("packing", "cooking"), /Некорректное действие/);
    await assert.rejects(service(sql, true).transitionOrder({ orderId: f.orderId, station: "main", status: "cooking", actorId: null, actorRole: "cook", deviceSource: "kds" }), /окружении/);
    assert.equal((await f.snapshot()).kitchen_status, "new");
    const [acl] = await sql`select has_function_privilege('anon', 'public.set_order_kitchen_station_status_atomic(uuid,text,text,uuid,text,text)', 'execute') as anon,
      has_table_privilege('authenticated', 'public.order_item_kitchen_state', 'update') as browser,
      (select prosecdef from pg_proc where oid = 'public.set_order_kitchen_station_status_atomic(uuid,text,text,uuid,text,text)'::regprocedure) as definer`;
    assert.deepEqual(acl, { anon: false, browser: false, definer: false });
  });
});

test("55440: hotdogs use mains in SQL and the legacy queue fallback without finishing snacks", localOnly, async () => {
  await withFixture(async (sql, f) => {
    const aliases = ['Хот-Доги', 'хот дог', 'хотдог', 'Hot Dogs', 'hot-dogs'];
    const stations = load("src/lib/order-flow/kitchen-stations.ts");
    const mapped = await sql`select category, public.kitchen_station_for_category(category) as station
      from unnest(${aliases}::text[]) category`;
    for (const row of mapped) {
      assert.equal(row.station, 'main', row.category);
      assert.equal(row.station, stations.kitchenStationForCategory(row.category));
    }
    const queries = load("src/lib/order-flow/queries.ts", {
      "server-only": {},
      "@/lib/postgres/server": { getPostgresSql: () => sql },
      "./kitchen-stations": stations
    }, { TEST_ORDER_MODE: 'false' });
    const readQueue = () => queries.getOrderFlowQueue({ locationId: f.locationId });
    const [created] = await readQueue();
    assert.equal(created.items.find(item => item.productId === f.products[0].id).kitchenStation, 'main');
    await sql`delete from public.order_item_kitchen_state where order_item_id in
      (select id from public.order_items where order_id = ${f.orderId})`;
    const [legacy] = await readQueue();
    assert.equal(legacy.items.find(item => item.productId === f.products[0].id).kitchenStation, 'main');
    assert.equal(legacy.items.find(item => item.productId === f.products[1].id).kitchenStation, 'snacks');
    await f.advance('main', 'cooking');
    await f.advance('main', 'ready');
    assert.equal((await f.snapshot()).kitchen_status, 'cooking');
    assert.equal((await f.snapshot()).deductions, 0);
    await f.advance('snacks', 'cooking');
    await f.advance('snacks', 'ready');
    assert.equal((await f.snapshot()).kitchen_status, 'ready');
    assert.equal((await f.snapshot()).deductions, 1);
  }, { categories: ['Хот-Доги', 'Снэки'] });
});

test("55440: test orders still complete without stock, payment or fiscal mutations", localOnly, async () => {
  await withFixture(async (_sql, f) => {
    for (const station of ["main", "snacks"]) { await f.advance(station, "cooking"); await f.advance(station, "ready"); }
    const row = await f.snapshot();
    assert.equal(row.kitchen_status, "ready");
    assert.equal(row.deductions, 0);
    assert.equal(row.movements, 0);
    assert.equal(row.receipts, 0);
    assert.equal(Number(row.balance), 0);
  }, { isTest: true, policy: "block" });
});

test("55440: online payment guard and immutable paid lines survive station readiness; settlement remains exactly once", localOnly, async () => {
  await withFixture(async (sql, f) => {
    const [customer] = await sql`insert into public.customers (name, phone, phone_verified_at)
      values ('Kitchen payment fixture', ${`+7${randomInt(1_000_000_000, 9_999_999_999)}`}, now()) returning id`;
    const [web] = await sql`select * from public.create_site_order_with_payment(
      ${customer.id}::uuid, 'pickup', null, null,
      ${sql.json(f.products.map((product) => ({ product_id: product.id, quantity: 2 })))}::jsonb,
      ${randomUUID()}::uuid, true, true, false, 'fixture', '/test/kitchen', 'test',
      'asap', null, 'kitchen@example.test', ${randomUUID()})`;
    const advance = (station, status, actorRole = 'cook') => service(sql).transitionOrder({
      orderId: web.order_id, station, status, actorId: null, actorRole, deviceSource: 'kitchen-regression'
    });
    await assert.rejects(advance('main', 'cooking'), /недоступен/);
    await assert.rejects(sql.savepoint(tx => tx`update public.orders set is_operational = true where id = ${web.order_id}`), /подтверждения оплаты/);
    await sql`select public.apply_yookassa_payment_state(${web.payment_id}::uuid, ${`fixture-${randomUUID()}`},
      'succeeded', true, 400, 'RUB', 'succeeded', 'bank_card', 400, now(), now())`;
    const commercial = await sql`select * from public.order_items where order_id = ${web.order_id} order by id`;
    await assert.rejects(sql.savepoint(tx => tx`update public.order_items set quantity = quantity + 1 where order_id = ${web.order_id}`));
    await sql`set local role karimoff_app`;
    for (const station of ['main', 'snacks']) { await advance(station, 'cooking'); await advance(station, 'ready'); }
    assert.deepEqual(await sql`select * from public.order_items where order_id = ${web.order_id} order by id`, commercial);
    await advance(undefined, 'handed_out', 'owner');
    await advance(undefined, 'handed_out', 'owner');
    await advance('main', 'ready');
    const [counts] = await sql`select
      (select count(*)::int from public.order_inventory_deductions where order_id = ${web.order_id}) as deductions,
      (select count(*)::int from public.fiscal_receipts where order_id = ${web.order_id} and receipt_phase = 'prepayment_settlement') as settlements,
      (select payment_status from public.orders where id = ${web.order_id}) as payment_status`;
    assert.deepEqual(counts, { deductions: 1, settlements: 1, payment_status: 'paid' });
  });
});

test("55440: legacy single-station complete also honors pilot policy and repeated ready", localOnly, async () => {
  await withFixture(async (sql, f) => {
    const advance = (status) => service(sql).transitionOrder({ orderId: f.orderId, status, actorId: null, actorRole: 'cook', deviceSource: 'legacy-kds' });
    await advance('cooking');
    await advance('ready');
    await advance('ready');
    const row = await f.snapshot();
    assert.equal(Number(row.balance), -20);
    assert.equal(row.deductions, 1);
    assert.equal(row.ready_events, 1);
  }, { categories: ['Бургеры'] });
});

test("55440: simultaneous employees and duplicate ready requests serialize into one deduction", localOnly, async () => {
  assert.equal(dsn, "postgres://postgres@127.0.0.1:55440/karimoff_audit");
  const sql = postgres(dsn, { max: 4, connect_timeout: 5, onnotice() {} });
  let f;
  try {
    const [identity] = await sql`select current_database() as name,
      to_regclass('local_audit.applied_migrations') is not null as disposable`;
    assert.deepEqual(identity, { name: "karimoff_audit", disposable: true });
    // Only this test's synthetic rows are committed so independent sessions can lock them.
    f = await sql.begin(tx => createFixture(tx));
    const advance = (station, status) => sql.begin(tx => service(tx).transitionOrder({
      orderId: f.orderId, station, status, actorId: null, actorRole: 'cook', deviceSource: 'concurrent-kitchen-regression'
    }));
    await advance('main', 'cooking');
    await advance('snacks', 'cooking');
    const results = await Promise.all(['main', 'snacks', 'main', 'snacks'].map(station => advance(station, 'ready')));
    assert.equal(results.filter(result => result.already_applied).length, 2);
    const [row] = await sql`select
      (select kitchen_status from public.orders where id = ${f.orderId}) as status,
      (select current_quantity::text from public.inventory_items where ingredient_id = ${f.ingredientId}) as balance,
      (select count(*)::int from public.order_inventory_deductions where order_id = ${f.orderId}) as deductions,
      (select count(*)::int from public.order_status_events where order_id = ${f.orderId} and to_status = 'ready') as ready_events`;
    assert.equal(row.status, 'ready');
    assert.equal(Number(row.balance), -40);
    assert.equal(row.deductions, 1);
    assert.equal(row.ready_events, 1);
  } finally {
    if (f) await sql.begin(async tx => {
      await tx`delete from public.inventory_movements where order_id = ${f.orderId}`;
      await tx`delete from public.audit_logs where entity_id = ${f.orderId}`;
      await tx`delete from public.order_outbox where aggregate_id = ${f.orderId}`;
      await tx`delete from public.orders where id = ${f.orderId}`;
      await tx`delete from public.products where id = any(${f.products.map(product => product.id)}::uuid[])`;
      await tx`delete from public.ingredients where id = ${f.ingredientId}`;
      await tx`delete from public.order_locations where id = ${f.locationId}`;
    });
    await sql.end({ timeout: 5 });
  }
});
