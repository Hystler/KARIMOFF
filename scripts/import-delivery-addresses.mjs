#!/usr/bin/env node
import postgres from "postgres";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAddressSnapshot,
  compareAddressSnapshots,
  createReviewGeoJson,
  summarizeDiff
} from "../src/lib/delivery/address-import.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultEndpoint = "https://overpass-api.de/api/interpreter";
const locationKey = "karimoff-main";

function parseArgs(args) {
  const day = new Date().toISOString().slice(0, 10);
  const options = { input: "", output: `outputs/delivery-whitelist-review-${day}`, against: "", sourceUrl: "" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") options.input = args[++index] ?? "";
    else if (argument === "--output") options.output = args[++index] ?? options.output;
    else if (argument === "--against") options.against = args[++index] ?? "";
    else if (argument === "--source-url") options.sourceUrl = args[++index] ?? "";
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--allow-remote") options.allowRemote = true;
    else if (argument === "--location-id") options.locationId = args[++index] ?? "";
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/import-delivery-addresses.mjs [options]\n\n`
    + `Options:\n`
    + `  --input FILE       Use saved Overpass JSON; omit to fetch a source snapshot\n`
    + `  --output DIR       Preview directory (default: outputs/delivery-whitelist-review-YYYY-MM-DD)\n`
    + `  --against FILE     Compare with a previous snapshot/export and produce a diff\n`
    + `  --source-url URL   Record endpoint when --input was obtained separately\n`
    + `  --apply            Upsert auto-approved and disabled review rows in a local DB\n`
    + `  --allow-remote     Also permit a remote DB; requires --apply and an explicit location UUID\n`
    + `  --location-id UUID Required with --apply; identifies the KARIMOFF location\n\n`
    + `Without --apply this command only writes local preview files. It never deletes database rows.`);
}

function resolvePath(path) {
  return isAbsolute(path) ? path : resolve(root, path);
}

function overpassQuery() {
  const latitude = 55.909221;
  const longitude = 38.055708;
  const radius = 3300;
  const latDelta = radius / 111_000;
  const lonDelta = radius / (111_000 * Math.cos(latitude * Math.PI / 180));
  const south = (latitude - latDelta).toFixed(6);
  const west = (longitude - lonDelta).toFixed(6);
  const north = (latitude + latDelta).toFixed(6);
  const east = (longitude + lonDelta).toFixed(6);
  return `[out:json][timeout:45];(nwr["addr:housenumber"](${south},${west},${north},${east}););out center tags;`;
}

async function fetchOverpass() {
  const endpoint = process.env.OVERPASS_URL || defaultEndpoint;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "user-agent": "KARIMOFF delivery whitelist initial import"
    },
    body: new URLSearchParams({ data: overpassQuery() }),
    signal: AbortSignal.timeout(90_000)
  });
  if (!response.ok) throw new Error(`Overpass returned HTTP ${response.status}. Save a source response and retry.`);
  return response.json();
}

function csvCell(value) {
  const text = value == null ? "" : Array.isArray(value) ? value.join(";") : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(records) {
  const fields = [
    "classification", "city", "street", "street_normalized", "house", "house_normalized",
    "building", "building_normalized", "postal_code", "latitude", "longitude",
    "distance_meters_precise", "boundary_distance_meters", "source", "source_id",
    "source_ids", "duplicate_count", "coordinate_spread_meters", "review_reasons", "flags"
  ];
  return [fields.join(","), ...records.map((record) =>
    fields.map((field) => csvCell(record[field])).join(",")
  )].join("\n") + "\n";
}

function recordsForUpsert(snapshot, diff) {
  const changed = new Set(diff.filter((item) => item.status === "COORDINATES CHANGED")
    .map((item) => item.address_key));
  return snapshot.records.filter((record) =>
    record.classification === "AUTO-APPROVABLE" || record.classification === "MANUAL REVIEW"
  ).map((record) => ({
    ...record,
    classification: changed.has(record.address_key) ? "MANUAL REVIEW" : record.classification,
    review_reasons: changed.has(record.address_key)
      ? [...new Set([...record.review_reasons, "SOURCE_COORDINATES_CHANGED"])].sort()
      : record.review_reasons
  }));
}

function validateDatabaseTarget(databaseUrl, allowRemote) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required with --apply.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (!allowRemote && !["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(hostname)) {
    throw new Error("Remote DATABASE_URL refused. Pass --allow-remote together with --apply and an explicit location UUID.");
  }
}

async function upsertDatabase(records, outsideRecords, { locationId, snapshotVersion, importedAt, allowRemote }) {
  const databaseUrl = process.env.DATABASE_URL;
  validateDatabaseTarget(databaseUrl, allowRemote);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(locationId)) {
    throw new Error("Pass an explicit valid --location-id UUID with --apply.");
  }
  const sql = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 5 });
  try {
    return await sql.begin(async (transaction) => {
      const [location] = await transaction`
        select id from public.order_locations where id = ${locationId}::uuid
          and location_key = ${locationKey} and is_active for share
      `;
      if (!location) throw new Error("The selected active location does not match KARIMOFF delivery.");

      for (const record of records) {
        const isAvailable = record.classification === "AUTO-APPROVABLE";
        const disabledReason = isAvailable ? null : "manual_review_required";
        await transaction`
          insert into public.delivery_addresses (
            location_id, city, street, street_normalized, house, house_normalized,
            building, building_normalized, display_name, postal_code, source, source_id,
            source_ids, source_snapshot_version, latitude, longitude, distance_meters,
            aerodrome_boundary_distance_meters, coordinate_spread_meters, duplicate_count,
            review_reasons, is_available, disabled_reason, imported_at
          ) values (
            ${locationId}::uuid, ${record.city}, ${record.street}, ${record.street_normalized},
            ${record.house}, ${record.house_normalized}, ${record.building}, ${record.building_normalized},
            null, ${record.postal_code}, 'openstreetmap', ${record.source_id}, ${record.source_ids},
            ${snapshotVersion}, ${record.latitude}, ${record.longitude}, ${record.distance_meters},
            ${record.boundary_distance_meters}, ${record.coordinate_spread_meters}, ${record.duplicate_count},
            ${record.review_reasons}, ${isAvailable}, ${disabledReason}, ${importedAt}
          )
          on conflict (location_id, street_normalized, house_normalized, building_normalized)
          do update set
            city = excluded.city,
            street = excluded.street,
            house = excluded.house,
            building = excluded.building,
            postal_code = excluded.postal_code,
            source = excluded.source,
            source_id = excluded.source_id,
            source_ids = excluded.source_ids,
            source_snapshot_version = excluded.source_snapshot_version,
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            distance_meters = excluded.distance_meters,
            aerodrome_boundary_distance_meters = excluded.aerodrome_boundary_distance_meters,
            coordinate_spread_meters = excluded.coordinate_spread_meters,
            duplicate_count = excluded.duplicate_count,
            review_reasons = excluded.review_reasons,
            imported_at = excluded.imported_at,
            is_available = case
              when public.delivery_addresses.disabled_reason in ('admin_disabled', 'rejected_by_admin') then false
              else excluded.is_available
            end,
            disabled_reason = case
              when public.delivery_addresses.disabled_reason in ('admin_disabled', 'rejected_by_admin')
                then public.delivery_addresses.disabled_reason
              else excluded.disabled_reason
            end,
            updated_at = now()
        `;
      }
      return disableExistingOutsideAddresses(transaction, outsideRecords, {
        locationId,
        snapshotVersion,
        importedAt
      });
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function disableExistingOutsideAddresses(transaction, records, { locationId, snapshotVersion, importedAt }) {
  if (!records.length) return 0;
  const sourceRows = records.map((record) => ({
    city: record.city,
    street: record.street,
    street_normalized: record.street_normalized,
    house: record.house,
    house_normalized: record.house_normalized,
    building: record.building,
    building_normalized: record.building_normalized,
    postal_code: record.postal_code,
    source_id: record.source_id,
    source_ids: record.source_ids,
    snapshot_version: snapshotVersion,
    latitude: record.latitude,
    longitude: record.longitude,
    distance_meters: record.distance_meters,
    boundary_distance_meters: record.boundary_distance_meters,
    coordinate_spread_meters: record.coordinate_spread_meters,
    duplicate_count: record.duplicate_count,
    review_reasons: record.review_reasons,
    outside_reason: record.excluded_by_aerodrome ? "inside_aerodrome" : "outside_delivery_zone"
  }));
  const updated = await transaction`
    with source_rows as (
      select * from jsonb_to_recordset(${transaction.json(sourceRows)}::jsonb) as source (
        city text,
        street text,
        street_normalized text,
        house text,
        house_normalized text,
        building text,
        building_normalized text,
        postal_code text,
        source_id text,
        source_ids jsonb,
        snapshot_version text,
        latitude double precision,
        longitude double precision,
        distance_meters integer,
        boundary_distance_meters double precision,
        coordinate_spread_meters double precision,
        duplicate_count integer,
        review_reasons jsonb,
        outside_reason text
      )
    )
    update public.delivery_addresses address set
      city = source.city,
      street = source.street,
      house = source.house,
      building = source.building,
      postal_code = source.postal_code,
      source_id = source.source_id,
      source_ids = array(select jsonb_array_elements_text(source.source_ids)),
      source_snapshot_version = source.snapshot_version,
      latitude = source.latitude,
      longitude = source.longitude,
      distance_meters = source.distance_meters,
      aerodrome_boundary_distance_meters = source.boundary_distance_meters,
      coordinate_spread_meters = source.coordinate_spread_meters,
      duplicate_count = source.duplicate_count,
      review_reasons = array(select jsonb_array_elements_text(source.review_reasons)),
      is_available = false,
      disabled_reason = case
        when address.disabled_reason in ('admin_disabled', 'rejected_by_admin') then address.disabled_reason
        else source.outside_reason
      end,
      imported_at = ${importedAt},
      updated_at = now()
    from source_rows source
    where address.location_id = ${locationId}::uuid
      and address.street_normalized = source.street_normalized
      and address.house_normalized = source.house_normalized
      and address.building_normalized = source.building_normalized
    returning address.id
  `;
  return updated.length;
}

function boundaryAreas(geojson) {
  return geojson.features.filter((feature) => feature.properties.role === "boundary_review_area")
    .map((feature) => ({
      area_id: feature.properties.area_id,
      longitude: feature.geometry.coordinates[0],
      latitude: feature.geometry.coordinates[1],
      instruction: feature.properties.instruction
  }));
}

function coordinatesIn(geometry) {
  if (geometry.type === "Point") return [geometry.coordinates];
  return geometry.coordinates.flat(Infinity).reduce((points, value, index, values) => {
    if (index % 2 === 0) points.push([value, values[index + 1]]);
    return points;
  }, []);
}

function createReviewHtml(geojson, summary) {
  const pointFeatures = geojson.features.filter((feature) => feature.geometry.type === "Point");
  const allPoints = geojson.features.flatMap((feature) => coordinatesIn(feature.geometry));
  const longitudes = allPoints.map((point) => point[0]);
  const latitudes = allPoints.map((point) => point[1]);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const width = 1000;
  const height = 680;
  const padding = 40;
  const project = ([longitude, latitude]) => {
    const x = padding + (longitude - minLon) / (maxLon - minLon || 1) * (width - padding * 2);
    const y = height - padding - (latitude - minLat) / (maxLat - minLat || 1) * (height - padding * 2);
    return [x, y];
  };
  const polygons = geojson.features.filter((feature) => feature.geometry.type === "Polygon");
  const circle = polygons.find((feature) => feature.properties.role === "delivery_radius");
  const aerodrome = polygons.find((feature) => feature.properties.role === "excluded_aerodrome");
  const polygonSvg = (feature, className) => feature
    ? feature.geometry.coordinates.map((ring) => `<polygon class="${className}" points="${ring.map((point) => project(point).join(",")).join(" ")}" />`).join("")
    : "";
  const store = pointFeatures.find((feature) => feature.properties.role === "store");
  const houses = pointFeatures.filter((feature) => feature.properties.role === "house_near_aerodrome_boundary");
  const areas = pointFeatures.filter((feature) => feature.properties.role === "boundary_review_area");
  const marker = (feature, label, className) => {
    const [x, y] = project(feature.geometry.coordinates);
    return `<g class="${className}"><circle cx="${x}" cy="${y}" r="8"/><text x="${x + 9}" y="${y - 8}">${label}</text></g>`;
  };
  const yandexLink = ([longitude, latitude]) => `https://yandex.ru/maps/?ll=${longitude}%2C${latitude}&z=16&pt=${longitude},${latitude},pm2rdm`;
  const houseList = houses.map((feature, index) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    const p = feature.properties;
    return `<li><b>H${index + 1}</b> ${escapeHtml(`${p.street}, ${p.house}`)} · ${p.distance_meters} м от KARIMOFF, ${p.boundary_distance_meters} м до полигона · ${escapeHtml(`${longitude}, ${latitude}`)}</li>`;
  }).join("");
  const areaList = areas.map((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    return `<li><a href="${yandexLink([longitude, latitude])}" target="_blank" rel="noreferrer">${feature.properties.area_id}</a> · ${longitude}, ${latitude} · <a href="${yandexLink([longitude, latitude])}" target="_blank" rel="noreferrer">Открыть Яндекс Карты</a></li>`;
  }).join("");
  const storeMarker = store ? marker(store, "KARIMOFF", "store") : "";
  const houseMarkers = houses.map((feature, index) => marker(feature, `H${index + 1}`, "house")).join("");
  const areaMarkers = areas.map((feature) => marker(feature, feature.properties.area_id, "area")).join("");
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KARIMOFF delivery whitelist review</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:24px;color:#202020}h1{margin:0 0 6px}.meta{color:#666;margin:0 0 16px}.map{max-width:100%;border:1px solid #ccc;background:#faf9f6}.aerodrome{fill:#df4d4d55;stroke:#a82121;stroke-width:3}.circle{fill:none;stroke:#246db3;stroke-width:3}.store circle{fill:#f18728;stroke:#743c0b;stroke-width:2}.house circle{fill:#8035ad;stroke:#fff;stroke-width:2}.area circle{fill:#159c67;stroke:#fff;stroke-width:2}.area text{fill:#0b6d48;font-weight:700}.store text,.house text{fill:#202020;font-weight:600}svg text{font-size:12px}section{margin-top:18px}li{margin:5px 0}.note{padding:10px 12px;background:#fff4d7;border-left:4px solid #e7a62d}.legend span{display:inline-block;margin-right:14px}</style>
<h1>KARIMOFF: проверка delivery whitelist</h1><p class="meta">OSM snapshot ${escapeHtml(String(summary.source_snapshot_version))}; центр 55.909221, 38.055708; радиус 3 км.</p>
<p class="note">Схема показывает геометрию и точки, без подложки. Для визуальной проверки рельефа и жилой застройки откройте ссылки A1–A8 на актуальной Яндекс Карте. Контур не менялся; внутри и на границе аэродрома доставка исключена.</p>
<svg class="map" viewBox="0 0 ${width} ${height}" role="img" aria-label="Контур аэродрома, круг доставки, точка магазина и дома у границы">${polygonSvg(circle, "circle")}${polygonSvg(aerodrome, "aerodrome")}${storeMarker}${houseMarkers}${areaMarkers}</svg>
<p class="legend"><span>🔵 3 км</span><span>🔴 исключённый аэродром</span><span>🟠 KARIMOFF</span><span>🟣 дома до 100 м от контура</span><span>🟢 участки A1–A8</span></p>
<section><h2>Восемь участков для визуальной сверки</h2><ol>${areaList}</ol></section>
<section><h2>Дома не дальше 100 м от границы</h2><ul>${houseList || "<li>Домов рядом с границей нет.</li>"}</ul></section>
<p>Источник адресов и контура: <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>; <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL 1.0</a>.</p></html>`;
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  const outputDir = resolvePath(options.output);
  if (options.allowRemote && !options.apply) {
    throw new Error("--allow-remote requires --apply.");
  }
  await mkdir(outputDir, { recursive: true });
  const raw = options.input
    ? JSON.parse(await readFile(resolvePath(options.input), "utf8"))
    : await fetchOverpass();
  const sourceEndpoint = options.sourceUrl || process.env.OVERPASS_URL || defaultEndpoint;
  const importedAt = new Date().toISOString();
  const snapshot = buildAddressSnapshot(raw, { importedAt });
  const diff = options.against
    ? compareAddressSnapshots(JSON.parse(await readFile(resolvePath(options.against), "utf8")), snapshot)
    : [];
  const upsertRecords = recordsForUpsert(snapshot, diff);
  const outsideRecords = snapshot.outside_zone_records;
  const autoRows = upsertRecords.filter((record) => record.classification === "AUTO-APPROVABLE");
  const reviewRows = upsertRecords.filter((record) => record.classification === "MANUAL REVIEW");
  const changedCoordinateKeys = new Set(diff.filter((item) => item.status === "COORDINATES CHANGED")
    .map((item) => item.address_key));
  const changedInZone = upsertRecords.filter((record) => changedCoordinateKeys.has(record.address_key)).length;
  const geojson = createReviewGeoJson(snapshot);
  const summary = {
    source: "OpenStreetMap via Overpass API",
    source_url: "https://www.openstreetmap.org/",
    source_endpoint: sourceEndpoint,
    source_snapshot_geometry: "https://www.openstreetmap.org/relation/3300255",
    source_license: "Open Database License 1.0 (ODbL)",
    source_attribution: "© OpenStreetMap contributors",
    source_snapshot_version: snapshot.source_snapshot_version,
    generated_at: importedAt,
    location_id: options.locationId || "karimoff-main (explicit UUID required on --apply)",
    center: snapshot.center,
    radius_meters: snapshot.radius_meters,
    aerodrome_source: "Unchanged excluded polygon from OSM relation 3300255.",
    boundary_semantics: snapshot.boundary_semantics,
    duplicate_coordinate_conflict_threshold_meters: 30,
    duplicate_threshold_rationale: "Up to 30 m is treated as one OSM house represented by multiple nearby objects; greater spread is ambiguous and remains disabled for review.",
    source_objects: snapshot.source_objects,
    unique_addresses: snapshot.unique_addresses,
    inside_3km_before_aerodrome_exclusion: snapshot.inside_3km_before_aerodrome_exclusion,
    auto_approvable: autoRows.length,
    manual_review: reviewRows.length,
    manual_review_before_diff: snapshot.manual_review,
    changed_coordinates_in_import_zone: changedInZone,
    outside_zone: snapshot.outside_zone,
    aerodrome_excluded: snapshot.aerodrome_excluded,
    existing_outside_addresses_disabled: null,
    near_aerodrome: snapshot.near_aerodrome_boundary,
    duplicate_groups: snapshot.duplicate_groups,
    duplicate_conflicts: snapshot.duplicate_conflicts,
    suspicious: snapshot.suspicious_addresses + snapshot.suspicious_source_objects,
    missing_coordinate_source_objects: snapshot.missing_coordinate_source_objects,
    missing_coordinate_unique_addresses: snapshot.missing_coordinate_unique_addresses,
    review_distance_band_2800_3000: snapshot.review_distance_band_2800_3000,
    diff_status_counts: diff.length ? summarizeDiff(diff) : null,
    database_write_performed: Boolean(options.apply)
  };

  await writeFile(resolve(outputDir, "raw-overpass.json"), `${JSON.stringify(raw, null, 2)}\n`);
  await writeFile(resolve(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(resolve(outputDir, "preview.json"), `${JSON.stringify({
    summary,
    auto_approvable: autoRows,
    manual_review: reviewRows,
    outside_zone: snapshot.outside_zone_records
  }, null, 2)}\n`);
  await writeFile(resolve(outputDir, "auto-approvable.json"), `${JSON.stringify(autoRows, null, 2)}\n`);
  await writeFile(resolve(outputDir, "manual-review.json"), `${JSON.stringify(reviewRows, null, 2)}\n`);
  await writeFile(resolve(outputDir, "outside-zone.json"), `${JSON.stringify(snapshot.outside_zone_records, null, 2)}\n`);
  await writeFile(resolve(outputDir, "unique-addresses.json"), `${JSON.stringify(snapshot.records, null, 2)}\n`);
  await writeFile(resolve(outputDir, "duplicate-groups.json"), `${JSON.stringify(snapshot.duplicate_records, null, 2)}\n`);
  await writeFile(resolve(outputDir, "duplicate-conflicts.json"), `${JSON.stringify(snapshot.duplicate_conflict_records, null, 2)}\n`);
  await writeFile(resolve(outputDir, "suspicious.json"), `${JSON.stringify(snapshot.suspicious_records, null, 2)}\n`);
  await writeFile(resolve(outputDir, "review-map.geojson"), `${JSON.stringify(geojson, null, 2)}\n`);
  await writeFile(resolve(outputDir, "review-map.html"), createReviewHtml(geojson, summary));
  await writeFile(resolve(outputDir, "auto-approvable.csv"), toCsv(autoRows));
  await writeFile(resolve(outputDir, "manual-review.csv"), toCsv(reviewRows));
  await writeFile(resolve(outputDir, "outside-zone.csv"), toCsv(snapshot.outside_zone_records));
  await writeFile(resolve(outputDir, "boundary-review-areas.csv"), [
    "area_id,longitude,latitude,instruction",
    ...boundaryAreas(geojson).map((area) =>
      [area.area_id, area.longitude, area.latitude, area.instruction].map(csvCell).join(",")
    )
  ].join("\n") + "\n");
  if (diff.length) {
    await writeFile(resolve(outputDir, "diff.json"), `${JSON.stringify({ status_counts: summarizeDiff(diff), records: diff }, null, 2)}\n`);
    await writeFile(resolve(outputDir, "diff.csv"), toCsv(diff));
  }
  await writeFile(resolve(outputDir, "README.md"), [
    "# KARIMOFF delivery whitelist source snapshot",
    "",
    `Snapshot: ${snapshot.source_snapshot_version ?? "timestamp unavailable"}`,
    `Generated: ${importedAt}`,
    `Source: OpenStreetMap via ${sourceEndpoint}`,
    "Attribution: © OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
    "License: Open Database License 1.0 (ODbL) — https://opendatacommons.org/licenses/odbl/1-0/",
    "The ODbL includes attribution and share-alike terms. This project records the source and license links; this file does not assert that a particular distribution setup satisfies every legal obligation.",
    "The address source may omit addr:city; city is kept nullable and is not used to determine delivery availability.",
    "AUTO-APPROVABLE rows have distance < 2800 m, are over 100 m from the excluded polygon, and have no recorded ambiguity flags.",
    "MANUAL REVIEW rows stay disabled. OUTSIDE ZONE rows are not seeded into the runtime whitelist.",
    "A periodic diff reports source removals but never deletes database rows. Coordinate changes are staged as manual review.",
    "The review GeoJSON includes the store point, a 3 km circle, the unchanged aerodrome polygon, nearby house points, and eight boundary review markers.",
    "When a previous snapshot is provided, source-coordinate changes move to MANUAL REVIEW. Existing admin-disabled rows remain disabled.",
    ""
  ].join("\n"));

  if (options.apply) {
    summary.existing_outside_addresses_disabled = await upsertDatabase(upsertRecords, outsideRecords, {
      locationId: options.locationId,
      snapshotVersion: snapshot.source_snapshot_version,
      importedAt,
      allowRemote: options.allowRemote
    });
    await writeFile(resolve(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    await writeFile(resolve(outputDir, "preview.json"), `${JSON.stringify({
      summary,
      auto_approvable: autoRows,
      manual_review: reviewRows,
      outside_zone: snapshot.outside_zone_records
    }, null, 2)}\n`);
  }

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Review artifacts: ${outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Address import failed.");
  process.exitCode = 1;
});
