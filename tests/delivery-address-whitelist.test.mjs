import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { makeAddressKey, normalizeHouse, normalizeStreet } from "../src/lib/delivery/address-normalization.mjs";
import {
  AERODROME_POLYGON,
  DELIVERY_CENTER,
  assessDeliveryPoint,
  haversineMeters,
  isInsideAerodrome
} from "../src/lib/delivery/address-geometry.mjs";
import {
  buildAddressSnapshot,
  compareAddressSnapshots,
  DUPLICATE_COORDINATE_CONFLICT_METERS
} from "../src/lib/delivery/address-import.mjs";

const read = (path) => readFileSync(resolve(path), "utf8");
const source = (id, house, point, street = "Бахчиванджи", extras = {}) => ({
  type: "node",
  id,
  lat: point[1],
  lon: point[0],
  tags: { "addr:street": street, "addr:housenumber": house, ...extras }
});

test("Russian street aliases share one key while house identities stay distinct", () => {
  assert.equal(normalizeStreet("Бахчиванджи"), "бахчиванджи");
  assert.equal(normalizeStreet("ул Бахчиванджи"), "бахчиванджи");
  assert.equal(normalizeStreet("улица Бахчиванджи"), "бахчиванджи");
  assert.equal(normalizeHouse("5Б"), "5Б");
  assert.equal(normalizeHouse("5б"), "5Б");
  assert.equal(normalizeHouse("5 Б"), "5Б");
  assert.equal(new Set(["5", "5А", "5Б", "5/1", "5 к1"].map(normalizeHouse)).size, 5);
  assert.equal(
    makeAddressKey({ locationId: "loc", street: "ул Бахчиванджи", house: "5б" }),
    makeAddressKey({ locationId: "loc", street: "улица Бахчиванджи", house: "5 Б" })
  );
});

test("nearby duplicate OSM points collapse deterministically under the 30 m threshold", () => {
  assert.equal(DUPLICATE_COORDINATE_CONFLICT_METERS, 30);
  const close = [
    source(2, "5Б", [DELIVERY_CENTER[0], DELIVERY_CENTER[1] + 0.00008], "ул Бахчиванджи"),
    source(1, "5 б", [DELIVERY_CENTER[0], DELIVERY_CENTER[1]], "улица Бахчиванджи")
  ];
  const first = buildAddressSnapshot({ elements: close });
  const second = buildAddressSnapshot({ elements: [...close].reverse() });
  assert.equal(first.unique_addresses, 1);
  assert.equal(first.duplicate_groups, 1);
  assert.equal(first.duplicate_conflicts, 0);
  assert.equal(first.auto_approvable, 1);
  assert.equal(first.records[0].city, null, "missing OSM addr:city remains nullable metadata");
  assert.deepEqual(first.records[0].source_ids, ["node/1", "node/2"]);
  assert.equal(first.records[0].source_id, "node/1");
  assert.deepEqual(first.records[0], second.records[0]);
  assert.ok(first.records[0].coordinate_spread_meters < 30);
});

test("same key with materially different coordinates is manual review and keeps one medoid", () => {
  const elements = [
    source(11, "7", [DELIVERY_CENTER[0], DELIVERY_CENTER[1]]),
    source(12, "7", [DELIVERY_CENTER[0], DELIVERY_CENTER[1] + 0.00036], "улица Бахчиванджи")
  ];
  const snapshot = buildAddressSnapshot({ elements });
  assert.equal(snapshot.unique_addresses, 1);
  assert.equal(snapshot.duplicate_conflicts, 1);
  assert.equal(snapshot.manual_review, 1);
  assert.ok(snapshot.records[0].coordinate_spread_meters > 30);
  assert.ok(snapshot.records[0].review_reasons.includes("DUPLICATE_COORDINATE_CONFLICT"));
});

test("exact distance and polygon boundary semantics are closed and explicitly excluded", () => {
  const ring = AERODROME_POLYGON.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  assert.equal(isInsideAerodrome(ring[0]), true);
  const point = [DELIVERY_CENTER[0], DELIVERY_CENTER[1] + 0.027];
  assert.ok(haversineMeters(DELIVERY_CENTER, point) > 3000);
  assert.equal(assessDeliveryPoint(ring[0]).excludedByAerodrome, true);
});

test("import preview classifies deduped houses and writes review artifacts without a database", () => {
  const temporary = mkdtempSync(join(tmpdir(), "karimoff-address-preview-"));
  try {
    const output = join(temporary, "preview");
    execFileSync(process.execPath, [
      "scripts/import-delivery-addresses.mjs",
      "--input", "tests/fixtures/delivery-address-import.json",
      "--output", output
    ], { encoding: "utf8" });
    const summary = JSON.parse(readFileSync(join(output, "summary.json"), "utf8"));
    const preview = JSON.parse(readFileSync(join(output, "preview.json"), "utf8"));
    const map = JSON.parse(readFileSync(join(output, "review-map.geojson"), "utf8"));
    assert.equal(summary.source_objects, 4);
    assert.equal(summary.unique_addresses, 3);
    assert.equal(summary.auto_approvable, 2);
    assert.equal(summary.manual_review, 0);
    assert.equal(summary.aerodrome_excluded, 1);
    assert.equal(summary.database_write_performed, false);
    assert.equal(preview.auto_approvable.some((address) => address.house_normalized === "5Б"), true);
    assert.equal(preview.auto_approvable.some((address) => address.house_normalized === "5/1"), true);
    assert.equal(map.features.some((feature) => feature.properties.role === "store"), true);
    assert.equal(map.features.some((feature) => feature.properties.role === "delivery_radius"), true);
    assert.equal(map.features.some((feature) => feature.properties.role === "excluded_aerodrome"), true);
    assert.equal(map.features.filter((feature) => feature.properties.role === "boundary_review_area").length, 8);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("snapshot diff reports new, removed, moved and unchanged addresses", () => {
  const previous = [
    { street: "Бахчиванджи", street_normalized: "бахчиванджи", house: "1", house_normalized: "1", latitude: 55.9092, longitude: 38.0557 },
    { street: "Бахчиванджи", street_normalized: "бахчиванджи", house: "2", house_normalized: "2", latitude: 55.9092, longitude: 38.0557 },
    { street: "Бахчиванджи", street_normalized: "бахчиванджи", house: "3", house_normalized: "3", latitude: 55.9092, longitude: 38.0557 }
  ];
  const current = buildAddressSnapshot({ elements: [
    source(1, "1", [38.0557, 55.9092]),
    source(2, "2", [38.0560, 55.9092]),
    source(4, "4", [38.0557, 55.9092])
  ] });
  const diff = compareAddressSnapshots(previous, current);
  assert.deepEqual(new Set(diff.map((entry) => entry.status)), new Set([
    "NEW", "REMOVED FROM SOURCE", "COORDINATES CHANGED", "UNCHANGED"
  ]));
});

test("frozen approval subset verifies checksums and rejects tampered source or candidates", () => {
  const temporary = mkdtempSync(join(tmpdir(), "karimoff-manifest-"));
  const digest = value => createHash("sha256").update(value).digest("hex");
  try {
    const raw = readFileSync("tests/fixtures/delivery-address-import.json");
    const snapshot = buildAddressSnapshot(JSON.parse(raw));
    const selected = snapshot.records.filter(row => row.classification === "AUTO-APPROVABLE").slice(0, 1);
    const candidates = selected.map(row => ({ ...row, candidate_id: "osmwh:" + digest(row.address_key) }));
    const manifest = {
      location_key: "karimoff-main", source_snapshot_version: snapshot.source_snapshot_version,
      source_snapshot_sha256: digest(raw), candidate_count: candidates.length, candidates,
      candidate_records_sha256: digest(JSON.stringify(candidates) + "\n"),
      candidate_ids_sha256: digest(candidates.map(row => row.candidate_id).join("\n") + "\n")
    };
    const manifestPath = join(temporary, "manifest.json");
    const save = () => { const bytes = JSON.stringify(manifest); writeFileSync(manifestPath, bytes); return digest(bytes); };
    const output = join(temporary, "preview");
    const invoke = checksum => execFileSync(process.execPath, ["scripts/import-delivery-addresses.mjs",
      "--input", "tests/fixtures/delivery-address-import.json", "--approval-manifest", manifestPath,
      "--manifest-sha256", checksum, "--output", output], { encoding: "utf8", stdio: "pipe" });
    const pinned = save();
    invoke(pinned);
    const summary = JSON.parse(readFileSync(join(output, "summary.json")));
    assert.equal(summary.auto_approvable, 1);
    assert.equal(summary.manual_review, 1, "Unlisted auto address remains disabled");
    assert.equal(summary.database_write_performed, false);
    assert.throws(() => invoke("0".repeat(64)), /checksum mismatch/);
    manifest.source_snapshot_sha256 = "0".repeat(64);
    assert.throws(() => invoke(save()), /metadata mismatch/);
    manifest.source_snapshot_sha256 = digest(raw);
    candidates[0].latitude += 0.01;
    manifest.candidate_records_sha256 = digest(JSON.stringify(candidates) + "\n");
    assert.throws(() => invoke(save()), /no longer matches/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("checkout and admin use server-side address IDs and preserve the current location boundary", () => {
  const actions = read("src/app/actions/orders.ts");
  const service = read("src/lib/order-flow/service.ts");
  const schema = read("src/lib/order-schema.ts");
  const migration = read("database/migrations/20261003180000_delivery_address_whitelist.sql");
  const cart = read("src/components/cart/CartDrawer.tsx");
  const admin = read("src/app/admin/delivery-addresses/actions.ts");
  assert.match(actions, /findDeliveryAddressById\(addressId, locationId\)/);
  assert.match(actions, /isAvailableDeliveryAddress\(address, addressId, locationId\)/);
  assert.doesNotMatch(actions, /formData\.get\("(?:address|latitude|longitude|distance_meters)"\)/);
  assert.match(service, /create_site_order_with_payment_from_whitelist/);
  assert.match(service, /p_delivery_address_id/);
  assert.match(service, /p_delivery_details/);
  assert.match(schema, /delivery_address_id: z\.string\(\)\.uuid\(\)/);
  assert.match(cart, /name="delivery_address_id"/);
  assert.match(cart, /listDeliveryHousesAction/);
  assert.match(migration, /for share/);
  assert.match(migration, /delivery_address_snapshot = v_delivery\.address_snapshot/);
  assert.match(migration, /location_id = p_location_id\s+and is_available/);
  assert.match(admin, /manual_review_required/);
  assert.match(admin, /bulkReviewDeliveryAddressesAction/);
  assert.match(admin, /ids\.length > 500/);
  assert.match(read("src/app/admin/delivery-addresses/page.tsx"), /limit 500/);
  assert.doesNotMatch(read("src/app/actions/orders.ts"), /YANDEX|GeoSuggest|DaData|geocoder/i);
});

test("checkout schema accepts missing apartment and entrance but requires one delivery address ID", async () => {
  const zod = await import("zod");
  const { loadTypeScript } = await import("./helpers/load-typescript.mjs");
  const { createOrderSchema } = loadTypeScript("src/lib/order-schema.ts", { zod });
  const base = {
    delivery_type: "delivery",
    fulfillment_mode: "asap",
    delivery_address_id: randomUUID(),
    receipt_email: "guest@example.test",
    cart: [{ product_id: randomUUID(), quantity: 1 }]
  };
  assert.equal(createOrderSchema.safeParse(base).success, true);
  assert.equal(createOrderSchema.safeParse({ ...base, delivery_address_id: "" }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...base, delivery_address_id: "forged" }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...base, delivery_apartment: "", delivery_entrance: "" }).success, true);
  assert.equal(createOrderSchema.safeParse({ ...base, delivery_type: "pickup", delivery_address_id: "" }).success, true);
});
