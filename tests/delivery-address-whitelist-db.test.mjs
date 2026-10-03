import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

const databaseUrl = process.env.DELIVERY_WHITELIST_TEST_DATABASE_URL;
const localDatabase = {
  skip: !databaseUrl && "Requires explicit disposable local DELIVERY_WHITELIST_TEST_DATABASE_URL"
};
const rollback = new Error("ROLLBACK_DELIVERY_WHITELIST_FIXTURE");
const defaultLocationId = "00000000-0000-4000-8000-000000000001";

function loadOrderService(database) {
  const compiled = ts.transpileModule(readFileSync("src/lib/order-flow/service.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  new Function("require", "exports", "process", compiled)((id) => {
    if (id === "server-only") return {};
    if (id === "@/lib/observability") return { logOperationalEvent() {} };
    if (id === "@/lib/database/server") return { createDatabaseServerClient: () => database };
    if (id === "@/lib/postgres/server") return {};
    throw new Error(`Unexpected import: ${id}`);
  }, exports, { env: { TEST_ORDER_MODE: "true" } });
  return exports.createOrder;
}

function createDatabaseAdapter(serviceRoleSql) {
  return {
    async rpc(name, args) {
      const statement = name === "create_site_order_from_whitelist"
        ? (transaction) => transaction`
            select * from public.create_site_order_from_whitelist(
              ${args.p_customer_id}::uuid, ${args.p_delivery_type}::text,
              ${args.p_delivery_address_id}::uuid, ${args.p_delivery_details == null ? null : transaction.json(args.p_delivery_details)}::jsonb,
              ${args.p_comment}::text, ${transaction.json(args.p_items)}::jsonb,
              ${args.p_idempotency_key}::uuid, ${args.p_personal_data_granted}::boolean,
              ${args.p_offer_accepted}::boolean, ${args.p_marketing_granted}::boolean,
              ${args.p_document_version}::text, ${args.p_source_path}::text,
              ${args.p_user_agent_short}::text, ${args.p_fulfillment_mode}::text,
              ${args.p_requested_at}::timestamptz, ${args.p_is_test}::boolean
            )
          `
        : null;
      if (!statement) return { data: null, error: { code: "42883", message: "Unexpected RPC" } };
      try {
        const data = await serviceRoleSql.savepoint((transaction) => statement(transaction));
        return { data, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    }
  };
}

async function assertCreateRejected(createOrder, input, addressId, message) {
  await assert.rejects(createOrder({ ...input, deliveryType: "delivery", deliveryAddressId: addressId }),
    (error) => error.code === "P0001" && error.message.includes(message));
}

test("isolated PostgreSQL checkout accepts only an available address ID and snapshots DB data", localDatabase, async () => {
  assert.equal(databaseUrl, "postgres://postgres@127.0.0.1:55444/karimoff_audit", "Use only the disposable 55444 PostgreSQL test database");
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "55444");
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice() {} });
  try {
    const [identity] = await sql`select current_database() as name,
      to_regclass('local_audit.applied_migrations') is not null as disposable`;
    assert.deepEqual(identity, { name: "karimoff_audit", disposable: true });
    await sql.begin(async (transaction) => {
      const [customer] = await transaction`
        insert into public.customers(name, phone)
        values ('Whitelist DB smoke', ${`+7${String(Date.now()).slice(-10)}`}) returning id
      `;
      const [product] = await transaction`
        insert into public.products(name, slug, category, price, is_active)
        values ('Whitelist DB smoke', ${`whitelist-db-${randomUUID()}`}, 'Тест', 123, true)
        returning id
      `;
      const [available] = await transaction`
        select id, location_id, street, house, building, latitude, longitude, distance_meters
        from public.delivery_addresses
        where location_id = ${defaultLocationId}::uuid and is_available
        order by distance_meters, street_normalized, house_normalized limit 1
      `;
      const [manual] = await transaction`
        select id from public.delivery_addresses
        where location_id = ${defaultLocationId}::uuid and disabled_reason = 'manual_review_required'
        limit 1
      `;
      const [otherLocation] = await transaction`
        insert into public.order_locations(location_key, name, is_default, is_active)
        values (${`whitelist-smoke-${randomUUID()}`}, 'Whitelist smoke location', false, true)
        returning id
      `;
      const [wrongLocationAddress] = await transaction`
        insert into public.delivery_addresses (
          location_id, city, street, street_normalized, house, house_normalized,
          building, building_normalized, source, source_id, latitude, longitude,
          distance_meters, is_available
        )
        select ${otherLocation.id}::uuid, city, street, street_normalized, house,
          house_normalized, building, building_normalized, source, source_id,
          latitude, longitude, distance_meters, true
        from public.delivery_addresses where id = ${available.id}::uuid returning id
      `;
      assert.ok(available && manual && wrongLocationAddress);

      const input = {
        source: "web",
        customerId: customer.id,
        deliveryType: "delivery",
        deliveryAddressId: available.id,
        deliveryDetails: { apartment: "7", entrance: "2", floor: "3", intercom: "19", courierComment: "Локальный smoke" },
        comment: null,
        items: [{ product_id: product.id, quantity: 1 }],
        idempotencyKey: randomUUID(),
        personalDataGranted: true,
        offerAccepted: true,
        marketingGranted: false,
        documentVersion: "delivery-whitelist-db-smoke",
        sourcePath: "/delivery-whitelist-db-smoke",
        userAgentShort: "local test",
        fulfillmentMode: "asap",
        requestedAt: null,
        receiptEmail: "smoke@example.test",
        requiresPayment: false
      };
      const database = createDatabaseAdapter(transaction);
      const createOrder = loadOrderService(database);
      await transaction`set local role karimoff_app`;

      const created = await createOrder(input);
      const [snapshot] = await transaction`
        select location_id, delivery_address_id, address, delivery_address_snapshot, is_test
        from public.orders where id = ${created.orderId}::uuid
      `;
      assert.equal(snapshot.location_id, defaultLocationId);
      assert.equal(snapshot.delivery_address_id, available.id);
      assert.equal(snapshot.delivery_address_snapshot.street, available.street);
      assert.equal(snapshot.delivery_address_snapshot.house, available.house);
      assert.equal(snapshot.delivery_address_snapshot.latitude, Number(available.latitude));
      assert.equal(snapshot.delivery_address_snapshot.longitude, Number(available.longitude));
      assert.equal(snapshot.delivery_address_snapshot.distance_meters, available.distance_meters);
      assert.equal(snapshot.delivery_address_snapshot.delivery_details.apartment, "7");
      assert.match(snapshot.address, /кв\. 7/);
      assert.equal(snapshot.is_test, true);

      const genericUnavailable = "По этому адресу доставка пока недоступна";
      await assertCreateRejected(createOrder, { ...input, idempotencyKey: randomUUID() }, randomUUID(), genericUnavailable);
      await assertCreateRejected(createOrder, { ...input, idempotencyKey: randomUUID() }, manual.id, genericUnavailable);
      await assertCreateRejected(createOrder, { ...input, idempotencyKey: randomUUID() }, wrongLocationAddress.id, genericUnavailable);
      await assertCreateRejected(createOrder, { ...input, idempotencyKey: randomUUID() }, "00000000-0000-4000-8000-000000000099", genericUnavailable);

      const pickup = await createOrder({
        ...input,
        deliveryType: "pickup",
        deliveryAddressId: null,
        deliveryDetails: null,
        idempotencyKey: randomUUID()
      });
      const [pickupSnapshot] = await transaction`
        select location_id, delivery_address_id, delivery_address_snapshot, address
        from public.orders where id = ${pickup.orderId}::uuid
      `;
      assert.equal(pickupSnapshot.location_id, defaultLocationId);
      assert.equal(pickupSnapshot.delivery_address_id, null);
      assert.equal(pickupSnapshot.delivery_address_snapshot, null);
      assert.equal(pickupSnapshot.address, null);
      throw rollback;
    }).catch((error) => { if (error !== rollback) throw error; });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("source refresh disables an existing address that has moved outside the zone without deleting it", localDatabase, async () => {
  assert.equal(databaseUrl, "postgres://postgres@127.0.0.1:55444/karimoff_audit");
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice() {} });
  const directory = mkdtempSync(join(tmpdir(), "karimoff-whitelist-refresh-"));
  const address = {
    street: "Зефирная улица",
    street_normalized: "зефирнаяулица",
    house: "99",
    house_normalized: "99",
    building: "",
    building_normalized: ""
  };
  try {
    const [existing] = await sql`
      insert into public.delivery_addresses (
        location_id, street, street_normalized, house, house_normalized,
        building, building_normalized, source, source_id, latitude, longitude,
        distance_meters, is_available
      ) values (
        ${defaultLocationId}::uuid, ${address.street}, ${address.street_normalized},
        ${address.house}, ${address.house_normalized}, '', '', 'openstreetmap',
        'node/old-outside-fixture', 55.909221, 38.055708, 0, true
      ) returning id
    `;
    const inputPath = join(directory, "source.json");
    const outputPath = join(directory, "preview");
    writeFileSync(inputPath, JSON.stringify({ elements: [{
      type: "node",
      id: 7654321,
      lat: 55.909221,
      lon: 38.11,
      tags: { "addr:street": address.street, "addr:housenumber": address.house }
    }] }));
    execFileSync(process.execPath, [
      "scripts/import-delivery-addresses.mjs",
      "--input", inputPath,
      "--source-url", "https://overpass-api.de/api/interpreter",
      "--output", outputPath,
      "--apply",
      "--location-id", defaultLocationId
    ], { encoding: "utf8", env: { ...process.env, DATABASE_URL: databaseUrl } });
    const [updated] = await sql`
      select id, is_available, disabled_reason, distance_meters, source_id
      from public.delivery_addresses where id = ${existing.id}::uuid
    `;
    const report = JSON.parse(readFileSync(join(outputPath, "summary.json"), "utf8"));
    assert.equal(updated.id, existing.id);
    assert.equal(updated.is_available, false);
    assert.equal(updated.disabled_reason, "outside_delivery_zone");
    assert.ok(updated.distance_meters > 3000);
    assert.equal(updated.source_id, "node/7654321");
    assert.equal(report.existing_outside_addresses_disabled, 1);
  } finally {
    await sql`delete from public.delivery_addresses
      where location_id = ${defaultLocationId}::uuid
        and street_normalized = ${address.street_normalized}
        and house_normalized = ${address.house_normalized}
        and building_normalized = ''`;
    rmSync(directory, { recursive: true, force: true });
    await sql.end({ timeout: 5 });
  }
});
