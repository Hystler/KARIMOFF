import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";
import * as normalizers from "../src/lib/delivery/address-normalization.mjs";
import * as addressGeometry from "../src/lib/delivery/address-geometry.mjs";

function harness() {
  const mode = loadTypeScript("src/lib/staging-ui-mode.ts", { "server-only": {} });
  const geo = loadTypeScript("src/lib/delivery/geo.ts");
  const imports = {
    "server-only": {}, "node:crypto": { createHash },
    "@/lib/staging-ui-mode": mode,
    "@/data/products": loadTypeScript("src/data/products.ts"),
    "@/lib/product-categories": loadTypeScript("src/lib/product-categories.ts"),
    "./delivery/address-normalization.mjs": normalizers,
    "./address-normalization.mjs": normalizers,
    "./address-geometry.mjs": addressGeometry
  };
  const fixture = loadTypeScript("src/lib/staging-fixtures.ts", imports);
  let connections = 0;
  const database = loadTypeScript("src/lib/postgres/server.ts", {
    "server-only": {}, postgres: () => { connections += 1; throw new Error("unexpected connection"); }
  });
  imports["@/lib/staging-fixtures"] = fixture;
  imports["@/lib/postgres/server"] = database;
  const whitelist = loadTypeScript("src/lib/delivery/address-whitelist.ts", imports);
  return { mode, geo, fixture, database, whitelist,
    settings: loadTypeScript("src/lib/delivery/settings.ts", imports), connections: () => connections };
}

async function inMode(run) {
  const values = { STAGING_UI_MODE: "true", STAGING_DATA_MODE: "fixture", DELIVERY_ENABLED: "true",
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/never_connect",
    MIGRATION_DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/never_connect" };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { await run(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("fixtures require BOTH flags and never connect even with accidental DB credentials", () => inMode(() => {
  const h = harness();
  assert.equal(h.mode.isStagingFixtureMode(), true);
  assert.equal(h.database.createPostgresServerClient(), null);
  assert.throws(() => h.database.getPostgresSql(), /PostgreSQL access is disabled/);
  assert.equal(h.connections(), 0);
  process.env.STAGING_UI_MODE = "false";
  assert.equal(h.mode.isStagingFixtureMode(), false);
  assert.throws(() => h.fixture.getFixtureProducts(), /require/);
  assert.throws(() => h.database.getPostgresSql(), /disabled/);
}));

test("public snapshot provenance, checksum and allowlisted fields are preserved", () => {
  const snapshot = JSON.parse(readFileSync("data/staging/approved-addresses.json", "utf8"));
  assert.equal(snapshot.addresses.length, 1233);
  const { export_url, export_sha256, fetched_at, ...original } = snapshot;
  assert.match(export_url, /stand.*\/api\/delivery-addresses\/open-data$/);
  assert.ok(fetched_at);
  assert.equal(createHash("sha256").update(JSON.stringify(original)).digest("hex"), export_sha256);
  assert.equal(snapshot.attribution, "© OpenStreetMap contributors");
  assert.match(snapshot.license, /ODbL/);
  for (const address of snapshot.addresses) assert.deepEqual(Object.keys(address),
    ["city", "street", "house", "building", "latitude", "longitude", "source_id", "source_snapshot_version"]);
});

test("server-owned catalog IDs are stable; forged products and modifiers are rejected", () => inMode(() => {
  const h = harness();
  const products = h.fixture.getFixtureProducts();
  assert.ok(products.length > 10);
  const cart = [{ product_id: products[0].id, quantity: 2, extras: [], removed_ingredient_ids: [], modifier_option_ids: [] }];
  assert.match(cart[0].product_id, /^[0-9a-f-]{36}$/);
  assert.equal(h.fixture.validateFixtureCart(cart), products[0].price * 2);
  assert.equal(h.fixture.validateFixtureCart([{ ...cart[0], product_id: randomUUID() }]), null);
  assert.equal(h.fixture.validateFixtureCart([{ ...cart[0], modifier_option_ids: [randomUUID()] }]), null);
}));

test("1233 approved addresses search/select server-side; unknown, disabled and wrong-location IDs fail closed", () => inMode(async () => {
  const h = harness();
  const id = await h.whitelist.getDefaultDeliveryLocationId();
  const addresses = h.fixture.getFixtureAddresses(id);
  assert.equal(addresses.length, 1233);
  assert.equal(new Set(addresses.map(address => address.id)).size, 1233);
  const streets = await h.whitelist.searchDeliveryStreets(id, "Бахчиванджи");
  assert.ok(streets.length);
  const houses = await h.whitelist.listDeliveryHouses(id, streets[0].street);
  assert.ok(houses.length);
  assert.ok(await h.whitelist.findDeliveryAddressById(houses[0].id, id));
  assert.equal(await h.whitelist.findDeliveryAddressById(houses[0].id, randomUUID()), null);
  assert.equal(await h.whitelist.findDeliveryAddressById(randomUUID(), id), null);
  assert.equal(await h.whitelist.findDeliveryAddressById("forged", id), null);
  assert.equal(await h.whitelist.hasAvailableDeliveryAddresses(randomUUID()), false);
  assert.deepEqual(await h.whitelist.searchDeliveryStreets(randomUUID(), "Бахчиванджи"), []);
  assert.equal(h.whitelist.isAvailableDeliveryAddress({ id: houses[0].id, location_id: id, is_available: false }, houses[0].id, id), false);
  assert.equal(h.connections(), 0);
}));

test("fixture delivery preserves geometry, airfield exclusion, fee/threshold, ETA and Moscow window", () => inMode(async () => {
  const h = harness();
  const config = await h.settings.getDeliveryLocationSettings();
  assert.equal(config.radiusMeters, 3000);
  assert.equal(config.deliveryFee, 200);
  assert.equal(config.freeThreshold, 2500);
  assert.equal(config.etaMinutes, 60);
  for (const address of h.fixture.getFixtureAddresses(config.locationId)) {
    assert.equal(h.geo.assessDeliveryZone({ ...config, address: [Number(address.longitude), Number(address.latitude)] }).available, true);
  }
  assert.equal(h.geo.assessDeliveryZone({ ...config, address: config.excludedAreas[0].geometry.coordinates[0][0] }).available, false);
  assert.equal(h.geo.assessDeliveryZone({ ...config, address: [39, 56] }).available, false);
  const { isDeliveryAcceptingAt } = loadTypeScript("src/lib/delivery/hours.ts");
  for (const [time, expected] of [["10:59", false], ["11:00", true], ["20:30", true], ["20:31", false]]) {
    assert.equal(isDeliveryAcceptingAt(new Date(`2026-10-10T${time}:00+03:00`), config), expected);
  }
  process.env.DELIVERY_ENABLED = "false";
  assert.equal((await h.settings.getDeliveryLocationSettings()).enabled, false);
  assert.equal(await h.settings.getDeliveryLocationSettings("forged"), null);
}));

test("both startup scripts skip all PostgreSQL work only for explicit staging fixtures", () => {
  for (const script of ["apply-runtime-schema-migrations.mjs", "apply-runtime-data-migrations.mjs"]) {
    const env = { ...process.env, NODE_ENV: "production", STAGING_UI_MODE: "true", STAGING_DATA_MODE: "fixture",
      DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/no", MIGRATION_DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/no" };
    const result = spawnSync(process.execPath, [`scripts/${script}`], { env, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PostgreSQL disabled/);
    const invalid = spawnSync(process.execPath, [`scripts/${script}`], { env: { ...env, STAGING_UI_MODE: "false" }, encoding: "utf8", timeout: 10000 });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /requires STAGING_UI_MODE/);
  }
});
